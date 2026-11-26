'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compass,
  ExternalLink,
  Loader2,
  MapPin,
  MessageSquare,
  Mic,
  MicOff,
  Navigation,
  PhoneOff,
  RotateCcw,
  Send,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';

export type AssistantTab = 'chat' | 'voice' | 'maps';

interface ChatMessageItem {
  id: number | string;
  role: 'user' | 'model';
  model: string;
  content: string;
  createdAt?: string;
}

interface MapsPlaceLink {
  title: string;
  uri: string;
  reviewSnippets: Array<{
    text: string;
    uri?: string;
    author?: string;
  }>;
}

interface VoiceTranscriptItem {
  id: string;
  speaker: 'user' | 'model';
  text: string;
}

interface EventLedgerAssistantProps {
  locale: 'ar' | 'en';
  open: boolean;
  activeTab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
  onClose: () => void;
}

const SESSION_ID = 'default-erp-concierge';

// Manual Float32 -> 16-bit PCM little-endian -> Base64 (Live API 16kHz input)
function float32ToPcm16Base64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Manual Base64 -> 16-bit PCM little-endian -> Float32Array (Live API 24kHz output)
function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const byteLength = binary.length;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export function EventLedgerAssistant({
  locale,
  open,
  activeTab,
  onTabChange,
  onClose,
}: EventLedgerAssistantProps) {
  const isRtl = locale === 'ar';
  const { authFetch, getAuthToken, user } = useAuth();

  // --- Tab 1: Multi-Turn Chat State ---
  const [chatMode, setChatMode] = useState<'general' | 'deep' | 'fast'>('general');
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [chatLoadingHistory, setChatLoadingHistory] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // --- Tab 2: Live Voice State (useRef for audio/WS callbacks) ---
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [voiceName, setVoiceName] = useState<'Zephyr' | 'Kore' | 'Puck' | 'Charon'>('Zephyr');
  const [isMuted, setIsMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTranscripts, setVoiceTranscripts] = useState<VoiceTranscriptItem[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isMutedRef = useRef<boolean>(false);
  const voiceConnectedRef = useRef<boolean>(false);

  // --- Tab 3: Google Maps Grounding State ---
  const [mapsQuery, setMapsQuery] = useState('');
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapsAnswer, setMapsAnswer] = useState<string>('');
  const [mapsPlaces, setMapsPlaces] = useState<MapsPlaceLink[]>([]);
  const [geoCoords, setGeoCoords] = useState<{ latitude: number; longitude: number; label: string } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  // Load persisted chat history when drawer opens and user is signed in
  const loadChatHistory = useCallback(async () => {
    if (!user) return;
    setChatLoadingHistory(true);
    setChatError(null);
    try {
      const res = await authFetch(`/api/v1/ai/chat?sessionId=${encodeURIComponent(SESSION_ID)}`);
      const data = await res.json();
      if (!res.ok) {
        setChatError(data?.detail || (isRtl ? 'تعذر تحميل سجل المحادثة.' : 'Unable to load conversation history.'));
        return;
      }
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch {
      setChatError(isRtl ? 'تعذر الاتصال بالخادم.' : 'Network error loading conversation history.');
    } finally {
      setChatLoadingHistory(false);
    }
  }, [authFetch, isRtl, user]);

  useEffect(() => {
    if (open && user) {
      loadChatHistory();
    }
  }, [open, user, loadChatHistory]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, chatSending]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // --- Voice Session Cleanup ---
  const stopAllPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    });
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const stopVoiceSession = useCallback(() => {
    voiceConnectedRef.current = false;
    stopAllPlayback();

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => undefined);
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => undefined);
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    setMicLevel(0);
    setVoiceStatus('idle');
  }, [stopAllPlayback]);

  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, [stopVoiceSession]);

  const scheduleAudioChunk = useCallback((base64Pcm: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;

    const float32 = pcm16Base64ToFloat32(base64Pcm);
    if (float32.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
    };
  }, []);

  const appendTranscript = useCallback((speaker: 'user' | 'model', text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setVoiceTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text} ${trimmed}`.trim() },
        ];
      }
      return [...prev, { id: `${Date.now()}-${Math.random()}`, speaker, text: trimmed }];
    });
  }, []);

  const startVoiceSession = async () => {
    if (voiceStatus !== 'idle') return;
    setVoiceError(null);
    setVoiceStatus('connecting');

    try {
      const token = await getAuthToken(false);
      if (!token) {
        setVoiceError(
          isRtl ? 'يرجى تسجيل الدخول بحساب Google لبدء المحادثة الصوتية.' : 'Please sign in with Google to start a voice session.'
        );
        setVoiceStatus('idle');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/live?locale=${locale}&voice=${voiceName}&token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        voiceConnectedRef.current = true;
        setVoiceStatus('connected');

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        source.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (event) => {
          if (!voiceConnectedRef.current || isMutedRef.current) {
            setMicLevel(0);
            return;
          }
          const socket = wsRef.current;
          if (!socket || socket.readyState !== WebSocket.OPEN) return;

          const inputData = event.inputBuffer.getChannelData(0);
          let sumSq = 0;
          for (let i = 0; i < inputData.length; i++) {
            sumSq += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sumSq / inputData.length);
          setMicLevel(Math.min(100, Math.round(rms * 380)));

          const base64 = float32ToPcm16Base64(inputData);
          socket.send(JSON.stringify({ audio: base64 }));
        };
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            audio?: string;
            interrupted?: boolean;
            inputTranscript?: string;
            outputTranscript?: string;
            error?: string;
            sessionClosed?: boolean;
          };

          if (msg.error) {
            setVoiceError(msg.error);
            stopVoiceSession();
            return;
          }
          if (msg.interrupted) {
            stopAllPlayback();
          }
          if (msg.audio) {
            scheduleAudioChunk(msg.audio);
          }
          if (msg.inputTranscript) {
            appendTranscript('user', msg.inputTranscript);
          }
          if (msg.outputTranscript) {
            appendTranscript('model', msg.outputTranscript);
          }
          if (msg.sessionClosed) {
            stopVoiceSession();
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        setVoiceError(
          isRtl
            ? 'تعذر الاتصال بخدمة الصوت المباشر. يرجى المحاولة مرة أخرى.'
            : 'Unable to connect to the live voice service. Please try again.'
        );
        stopVoiceSession();
      };

      ws.onclose = () => {
        if (voiceConnectedRef.current) {
          stopVoiceSession();
        }
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : isRtl
          ? 'يرجى السماح بالوصول إلى الميكروفون لبدء المحادثة الصوتية.'
          : 'Microphone access is required to start a voice session.';
      setVoiceError(msg);
      stopVoiceSession();
    }
  };

  // --- Chat Handlers ---
  const sendChatMessage = async (promptOverride?: string) => {
    const text = (promptOverride ?? chatInput).trim();
    if (!text || chatSending) return;

    setChatSending(true);
    setChatError(null);
    const optimisticId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: 'user', model: chatMode, content: text },
    ]);
    if (!promptOverride) setChatInput('');

    try {
      const res = await authFetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: SESSION_ID,
          locale,
          mode: chatMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setChatError(data?.detail || (isRtl ? 'تعذر الحصول على رد المساعد.' : 'Unable to get assistant reply.'));
        return;
      }

      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== optimisticId);
        const next: ChatMessageItem[] = [...withoutTemp];
        if (data?.userMessage) next.push(data.userMessage);
        if (data?.assistantMessage) next.push(data.assistantMessage);
        return next;
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setChatError(isRtl ? 'تعذر الاتصال بالخادم.' : 'Network error sending message.');
    } finally {
      setChatSending(false);
    }
  };

  const resetChatThread = async () => {
    setChatError(null);
    try {
      await authFetch(`/api/v1/ai/chat?sessionId=${encodeURIComponent(SESSION_ID)}`, {
        method: 'DELETE',
      });
      setMessages([]);
    } catch {
      setChatError(isRtl ? 'تعذر مسح المحادثة.' : 'Unable to reset thread.');
    }
  };

  // --- Maps Grounding Handlers ---
  const detectUserLocation = () => {
    if (!navigator.geolocation) {
      setMapsError(
        isRtl ? 'المتصفح لا يدعم تحديد الموقع الجغرافي.' : 'Geolocation is not supported in this browser.'
      );
      return;
    }
    setGeoLoading(true);
    setMapsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoCoords({
          latitude: Number(pos.coords.latitude.toFixed(5)),
          longitude: Number(pos.coords.longitude.toFixed(5)),
          label: isRtl ? 'موقعي الحالي' : 'Current Location',
        });
        setGeoLoading(false);
      },
      () => {
        setMapsError(
          isRtl
            ? 'تعذر قراءة موقعك الجغرافي. يمكنك اختيار مدينة مرجعية أو كتابة اسم المنطقة.'
            : 'Unable to read browser location. Select a reference city or include a city in your query.'
        );
        setGeoLoading(false);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const runMapsSearch = async (queryOverride?: string) => {
    const q = (queryOverride ?? mapsQuery).trim();
    if (!q || mapsLoading) return;
    if (queryOverride) setMapsQuery(queryOverride);

    setMapsLoading(true);
    setMapsError(null);
    try {
      const res = await authFetch('/api/v1/ai/maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          locale,
          latitude: geoCoords?.latitude,
          longitude: geoCoords?.longitude,
          locationLabel: geoCoords?.label,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMapsError(data?.detail || (isRtl ? 'تعذر البحث عبر خرائط Google.' : 'Unable to fetch Google Maps results.'));
        return;
      }
      setMapsAnswer(data?.text || '');
      setMapsPlaces(Array.isArray(data?.places) ? data.places : []);
    } catch {
      setMapsError(isRtl ? 'خطأ في الاتصال بالخادم.' : 'Network error querying Google Maps.');
    } finally {
      setMapsLoading(false);
    }
  };

  if (!open) return null;

  const chatStarters = isRtl
    ? [
        'لخّص حجوزات هذا الأسبوع وحالة الدفعات المقدمة',
        'هل يوجد أي تعارض محتمل مع فترات التنظيف في قاعة الماسة؟',
        'جهّز قائمة تشغيل لحفل زفاف 420 ضيفاً في قاعة الماسة',
      ]
    : [
        'Summarize this week’s upcoming bookings and unpaid deposits',
        'Check Grand Diamond Hall turnaround buffer gaps for conflicts',
        'Draft a run-of-show checklist for a 420-guest wedding banquet',
      ];

  const mapsStarters = isRtl
    ? [
        'أفضل فنادق 5 نجوم قريبة لاستضافة ضيوف حفلات الزفاف',
        'أفضل شركات تنسيق الزهور وتجهيز المسارح القريبة',
        'أفضل مطاعم وموردي البوفيه والضيافة الفاخرة',
      ]
    : [
        'Top 5-star hotels nearby for out-of-town wedding guests',
        'Event floral decorators and stage lighting vendors nearby',
        'Luxury banquet catering & coffee hospitality suppliers nearby',
      ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isRtl ? 'مساعد عمليات إيفنت ليدجر الذكي' : 'EventLedger AI Operations Suite'}
        className="flex h-full w-full max-w-xl flex-col border-s border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-amber-600 dark:text-[#D4AF37]" />
              <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isRtl ? 'مساعد عمليات إيفنت ليدجر' : 'EventLedger AI Concierge'}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {isRtl
                ? 'محادثة تشغيلية · مكالمة صوتية فورية · استكشاف المواقع والموردين'
                : 'Venue chat · Real-time voice · Google Maps vendor discovery'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopVoiceSession();
              onClose();
            }}
            aria-label={isRtl ? 'إغلاق المساعد' : 'Close assistant'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 3-Tab Navigation */}
        <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={() => onTabChange('chat')}
            className={`flex min-h-[44px] items-center justify-center gap-2 border-b-2 px-3 text-xs font-semibold transition-colors ${
              activeTab === 'chat'
                ? 'border-[var(--brand-primary,#D4AF37)] bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{isRtl ? 'المحادثة' : 'Chat'}</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('voice')}
            className={`flex min-h-[44px] items-center justify-center gap-2 border-b-2 px-3 text-xs font-semibold transition-colors ${
              activeTab === 'voice'
                ? 'border-[var(--brand-primary,#D4AF37)] bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Mic className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{isRtl ? 'صوت مباشر' : 'Live Voice'}</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('maps')}
            className={`flex min-h-[44px] items-center justify-center gap-2 border-b-2 px-3 text-xs font-semibold transition-colors ${
              activeTab === 'maps'
                ? 'border-[var(--brand-primary,#D4AF37)] bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{isRtl ? 'خرائط وموردون' : 'Maps'}</span>
          </button>
        </div>

        {/* TAB 1: MULTI-TURN CHATBOT */}
        {activeTab === 'chat' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Mode Selector & Reset Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 text-xs dark:border-slate-800">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900">
                {(
                  [
                    { id: 'general', labelEn: 'Standard', labelAr: 'متوازن' },
                    { id: 'deep', labelEn: 'Deep Audit', labelAr: 'تحليل عميق' },
                    { id: 'fast', labelEn: 'Fast', labelAr: 'سريع' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setChatMode(item.id)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      chatMode === item.id
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {isRtl ? item.labelAr : item.labelEn}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={resetChatThread}
                disabled={messages.length === 0 || chatSending}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
              >
                <RotateCcw className="h-3 w-3" />
                <span>{isRtl ? 'محادثة جديدة' : 'New Thread'}</span>
              </button>
            </div>

            {/* Scrollable Thread */}
            <div ref={chatScrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {chatLoadingHistory ? (
                <div className="flex items-center justify-center py-12 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  <span>{isRtl ? 'جاري تحميل المحادثة...' : 'Loading conversation...'}</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="space-y-4 py-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {isRtl ? 'مساعد عمليات قصر الماسة جاهز' : 'Al-Massa Operations Concierge Ready'}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {isRtl
                        ? 'اسأل عن حجوزات القاعات الحالية، فترات التجهيز، الدفعات المالية، أو اطلب خطة تنفيذ لفعالية قادمة.'
                        : 'Ask about current hall reservations, turnaround buffers, deposit balances, or request an event run-of-show.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {isRtl ? 'اقتراحات سريعة' : 'Suggested Prompts'}
                    </div>
                    {chatStarters.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => sendChatMessage(starter)}
                        className="block w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-start text-xs text-slate-700 transition-colors hover:border-amber-500/60 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-[#D4AF37]/60 dark:hover:bg-slate-800/80"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[88%] whitespace-pre-wrap rounded-xl px-4 py-3 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-slate-900 text-white dark:bg-[#D4AF37] dark:text-slate-950'
                          : 'border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))
              )}

              {chatSending && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{isRtl ? 'جاري تحليل جدول الصالة وإعداد الرد...' : 'Analyzing venue schedule...'}</span>
                </div>
              )}
            </div>

            {chatError && (
              <div className="mx-4 mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                {chatError}
              </div>
            )}

            {/* Chat Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendChatMessage();
              }}
              className="flex items-center gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatSending}
                placeholder={
                  isRtl ? 'اكتب سؤالك حول الحجوزات أو القاعات...' : 'Ask about bookings, halls, or deposits...'
                }
                className="min-h-[42px] flex-1 rounded-lg border border-slate-200 bg-white px-3.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={chatSending || !chatInput.trim()}
                aria-label={isRtl ? 'إرسال الرسالة' : 'Send message'}
                className="inline-flex h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{isRtl ? 'إرسال' : 'Send'}</span>
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: REAL-TIME VOICE CONCIERGE (GEMINI LIVE API) */}
        {activeTab === 'voice' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'المساعد الصوتي المباشر للعمليات' : 'Live Voice Venue Concierge'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {isRtl
                      ? 'تحدث مباشرة للاستفسار عن الحجوزات وتنسيق القاعات بدون كتابة.'
                      : 'Speak naturally in Arabic or English to check schedules and coordinate events.'}
                  </div>
                </div>

                <select
                  value={voiceName}
                  disabled={voiceStatus !== 'idle'}
                  onChange={(e) => setVoiceName(e.target.value as 'Zephyr' | 'Kore' | 'Puck' | 'Charon')}
                  aria-label={isRtl ? 'اختر صوت المساعد' : 'Select assistant voice'}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:outline-none disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="Zephyr">Zephyr</option>
                  <option value="Kore">Kore</option>
                  <option value="Puck">Puck</option>
                  <option value="Charon">Charon</option>
                </select>
              </div>

              {/* Reactive Audio Level Bar & Controls */}
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {voiceStatus === 'idle'
                      ? isRtl
                        ? 'جاهز لبدء المكالمة الصوتية'
                        : 'Ready to start voice session'
                      : voiceStatus === 'connecting'
                      ? isRtl
                        ? 'جاري الاتصال بالميكروفون...'
                        : 'Connecting live audio...'
                      : isMuted
                      ? isRtl
                        ? 'الميكروفون مكتوم'
                        : 'Microphone muted'
                      : isRtl
                      ? 'جلسة صوتية نشطة — تحدث الآن'
                      : 'Voice session active — speak now'}
                  </span>
                  <Volume2 className="h-4 w-4 text-slate-400" />
                </div>

                {/* Live Mic Input Level Meter */}
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-[var(--brand-primary,#D4AF37)] transition-all duration-75"
                    style={{ width: `${voiceStatus === 'connected' && !isMuted ? Math.max(4, micLevel) : 0}%` }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  {voiceStatus === 'idle' ? (
                    <button
                      type="button"
                      onClick={startVoiceSession}
                      className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90"
                    >
                      <Mic className="h-4 w-4" />
                      <span>{isRtl ? 'بدء المحادثة الصوتية' : 'Start Voice Conversation'}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsMuted((m) => !m)}
                        disabled={voiceStatus === 'connecting'}
                        className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      >
                        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        <span>
                          {isMuted
                            ? isRtl
                              ? 'إلغاء الكتم'
                              : 'Unmute'
                            : isRtl
                            ? 'كتم الميكروفون'
                            : 'Mute Mic'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={stopVoiceSession}
                        className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
                      >
                        <PhoneOff className="h-4 w-4" />
                        <span>{isRtl ? 'إنهاء' : 'End'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {voiceError && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                  {voiceError}
                </div>
              )}
            </div>

            {/* Live Transcript Feed */}
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <span>{isRtl ? 'النص المباشر للمكالمة' : 'Live Conversation Transcript'}</span>
                {voiceTranscripts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setVoiceTranscripts([])}
                    className="hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    {isRtl ? 'مسح' : 'Clear'}
                  </button>
                )}
              </div>

              {voiceTranscripts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {isRtl
                    ? 'سيظهر النص المنطوق لك وللمساعد هنا فور بدء المحادثة الصوتية.'
                    : 'Your spoken words and the concierge’s voice replies will appear here live.'}
                </div>
              ) : (
                voiceTranscripts.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      item.speaker === 'user'
                        ? 'ms-8 bg-slate-900 text-white dark:bg-[#D4AF37] dark:text-slate-950'
                        : 'me-8 border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                    }`}
                  >
                    <div className="mb-1 text-[10px] font-semibold opacity-70">
                      {item.speaker === 'user'
                        ? isRtl
                          ? 'أنت'
                          : 'You'
                        : isRtl
                        ? 'مساعد إيفنت ليدجر'
                        : 'EventLedger Concierge'}
                    </div>
                    <div>{item.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: GOOGLE MAPS GROUNDING */}
        {activeTab === 'maps' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {isRtl ? 'استكشاف الفنادق والموردين عبر خرائط Google' : 'Nearby Hotels & Venue Vendors (Google Maps)'}
                </div>
                <button
                  type="button"
                  onClick={detectUserLocation}
                  disabled={geoLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {geoLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Navigation className="h-3 w-3" />
                  )}
                  <span>{isRtl ? 'موقعي الحالي' : 'Use My Location'}</span>
                </button>
              </div>

              {/* Reference City Presets for Venue Operations */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">
                  {isRtl ? 'النطاق الجغرافي:' : 'Area:'}
                </span>
                {[
                  { labelEn: 'Riyadh', labelAr: 'الرياض', latitude: 24.7136, longitude: 46.6753 },
                  { labelEn: "Sana'a", labelAr: 'صنعاء', latitude: 15.3694, longitude: 44.191 },
                  { labelEn: 'Dubai', labelAr: 'دبي', latitude: 25.2048, longitude: 55.2708 },
                ].map((city) => {
                  const active =
                    geoCoords?.latitude === city.latitude && geoCoords?.longitude === city.longitude;
                  return (
                    <button
                      key={city.labelEn}
                      type="button"
                      onClick={() =>
                        setGeoCoords({
                          latitude: city.latitude,
                          longitude: city.longitude,
                          label: isRtl ? city.labelAr : city.labelEn,
                        })
                      }
                      className={`rounded-md border px-2 py-1 font-medium transition-colors ${
                        active
                          ? 'border-[var(--brand-primary,#D4AF37)] bg-amber-50 text-amber-900 dark:bg-[#D4AF37]/15 dark:text-[#D4AF37]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {isRtl ? city.labelAr : city.labelEn}
                    </button>
                  );
                })}
                {geoCoords && (
                  <span className="font-mono text-[10px] tabular-nums text-slate-400">
                    ({geoCoords.latitude}, {geoCoords.longitude})
                  </span>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runMapsSearch();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={mapsQuery}
                  onChange={(e) => setMapsQuery(e.target.value)}
                  disabled={mapsLoading}
                  placeholder={
                    isRtl
                      ? 'ابحث عن فنادق للضيوف، شركات ضيافة، تنسيق زهور...'
                      : 'Search nearby guest hotels, caterers, florists, parking...'
                  }
                  className="min-h-[40px] flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={mapsLoading || !mapsQuery.trim()}
                  className="inline-flex h-[40px] shrink-0 items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-3.5 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {mapsLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Compass className="h-3.5 w-3.5" />
                  )}
                  <span>{isRtl ? 'بحث' : 'Search'}</span>
                </button>
              </form>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {mapsError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                  {mapsError}
                </div>
              )}

              {!mapsAnswer && mapsPlaces.length === 0 && !mapsLoading && (
                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {isRtl ? 'عمليات بحث مقترحة للفعاليات' : 'Quick Venue Logistics Searches'}
                  </div>
                  {mapsStarters.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => runMapsSearch(starter)}
                      className="block w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-start text-xs text-slate-700 transition-colors hover:border-amber-500/60 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-[#D4AF37]/60 dark:hover:bg-slate-800/80"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              )}

              {mapsLoading && (
                <div className="flex items-center justify-center py-10 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  <span>{isRtl ? 'جاري البحث عبر خرائط Google...' : 'Searching Google Maps data...'}</span>
                </div>
              )}

              {mapsAnswer && (
                <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {mapsAnswer}
                </div>
              )}

              {/* Mandatory Google Maps Grounding Links & Review Snippets */}
              {mapsPlaces.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {isRtl ? 'المواقع والمصادر على خرائط Google' : 'Google Maps Places & Sources'}
                  </div>
                  <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                    {mapsPlaces.map((place) => (
                      <div key={place.uri} className="p-3.5">
                        <a
                          href={place.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-center justify-between gap-3 text-xs font-semibold text-slate-900 hover:text-amber-700 dark:text-slate-100 dark:hover:text-[#D4AF37]"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-[#D4AF37]" />
                            <span className="truncate">{place.title}</span>
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-amber-600 dark:group-hover:text-[#D4AF37]" />
                        </a>

                        {place.reviewSnippets.length > 0 && (
                          <div className="mt-2 space-y-1.5 ps-5">
                            {place.reviewSnippets.map((snippet, idx) => (
                              <div
                                key={`${place.uri}-snippet-${idx}`}
                                className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
                              >
                                {snippet.text && <p>“{snippet.text}”</p>}
                                {snippet.uri && (
                                  <a
                                    href={snippet.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-0.5 inline-flex items-center gap-1 font-medium text-amber-700 underline-offset-4 hover:underline dark:text-[#D4AF37]"
                                  >
                                    <span>{isRtl ? 'عرض التقييم على خرائط Google' : 'View review on Google Maps'}</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
