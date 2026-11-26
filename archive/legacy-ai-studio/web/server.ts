import http from 'node:http';
import path from 'node:path';
import { parse } from 'node:url';
import dotenv from 'dotenv';
import next from 'next';
import { WebSocketServer, type WebSocket } from 'ws';
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { listAllHalls, listScheduledEvents } from '../../src/db/bookings.ts';

// Load workspace root .env then local .env
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = Number(process.env.PORT || 3000);

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}
const adminAuth = getAuth();

async function getVoiceContextSummary(): Promise<string> {
  try {
    const [halls, events] = await Promise.all([listAllHalls(), listScheduledEvents()]);
    const hallLines = halls
      .map((h) => `${h.nameEn} (${h.nameAr}, banquet ${h.capacityBanquet}, buffer ${h.cleaningBufferMinutes}m)`)
      .join('; ');
    const eventLines = events
      .slice(0, 10)
      .map(
        (e) =>
          `${e.eventCode}: ${e.titleEn} in ${e.hallNameEn} on ${e.startTime.slice(0, 16)} (${e.status}, ${e.guestCount} guests)`
      )
      .join('; ');
    return `Halls: ${hallLines}. Upcoming bookings: ${eventLines}.`;
  } catch {
    return 'Halls: Grand Diamond Hall (500 banquet), Royal Jasmine Hall (300 banquet), Emerald Executive Suite (140 banquet).';
  }
}

function safeSend(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();
  const nextUpgradeHandler = app.getUpgradeHandler();

  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url || '/', true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (clientWs, req) => {
    const parsed = parse(req.url || '/', true);
    const locale = parsed.query.locale === 'en' ? 'en' : 'ar';
    const token = typeof parsed.query.token === 'string' ? parsed.query.token : '';
    const voiceName =
      typeof parsed.query.voice === 'string' &&
      ['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'].includes(parsed.query.voice)
        ? parsed.query.voice
        : 'Zephyr';

    if (!token) {
      safeSend(clientWs, { error: 'Unauthorized: Please sign in with Google to start a voice session.' });
      clientWs.close(4001, 'Unauthorized');
      return;
    }

    try {
      await adminAuth.verifyIdToken(token);
    } catch (err) {
      console.error('Live WS auth failed:', err);
      safeSend(clientWs, { error: 'Unauthorized: Invalid or expired session token.' });
      clientWs.close(4001, 'Unauthorized');
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      safeSend(clientWs, {
        error: 'GEMINI_API_KEY is not configured. Please check Settings > Secrets.',
      });
      clientWs.close(1011, 'Missing API Key');
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const scheduleContext = await getVoiceContextSummary();
    const systemInstruction =
      locale === 'ar'
        ? `أنت المساعد الصوتي المباشر لعمليات صالة "قصر الماسة للمؤتمرات والأفراح" في نظام إيفنت ليدجر. تحدث بإيجاز ووضوح ودفء باللغة العربية (أو الإنجليزية إذا سُئلت بها). ساعد الموظفين في التحقق من حجوزات القاعات، السعة، فترات التنظيف، وتجهيز الفعاليات. السياق الحالي: ${scheduleContext}`
        : `You are the real-time Voice Operations Concierge for Al-Massa Grand Palace on EventLedger ERP. Speak naturally, clearly, and concisely. Help staff check upcoming hall schedules, capacities, turnaround buffers, and event logistics. Current schedule context: ${scheduleContext}`;

    let closed = false;
    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    try {
      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            safeSend(clientWs, { ready: true, model: 'gemini-3.8-live', voice: voiceName });
          },
          onmessage: (message: LiveServerMessage) => {
            if (closed) return;
            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              safeSend(clientWs, { inputTranscript: content.inputTranscription.text });
            }
            if (content?.outputTranscription?.text) {
              safeSend(clientWs, { outputTranscript: content.outputTranscription.text });
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                safeSend(clientWs, { audio: part.inlineData.data });
              }
            }

            if (content?.interrupted) {
              safeSend(clientWs, { interrupted: true });
            }
            if (content?.turnComplete) {
              safeSend(clientWs, { turnComplete: true });
            }
          },
          onerror: (err: unknown) => {
            console.error('Gemini Live session error:', err);
            const msg = err instanceof Error ? err.message : 'Live voice session encountered an error.';
            safeSend(clientWs, { error: msg });
          },
          onclose: () => {
            if (!closed) {
              closed = true;
              safeSend(clientWs, { sessionClosed: true });
              if (clientWs.readyState === clientWs.OPEN) {
                clientWs.close();
              }
            }
          },
        },
      });
    } catch (err) {
      console.error('Failed to connect Gemini Live session:', err);
      const msg =
        err instanceof Error ? err.message : 'Failed to connect to Gemini Live voice service.';
      safeSend(clientWs, { error: msg });
      clientWs.close(1011, 'Gemini Live connection failed');
      return;
    }

    clientWs.on('message', (raw) => {
      if (closed || !liveSession) return;
      try {
        const parsedMsg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
        if (parsedMsg.audio) {
          liveSession.sendRealtimeInput({
            audio: {
              data: parsedMsg.audio,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (parsedMsg.text) {
          liveSession.sendRealtimeInput({
            text: parsedMsg.text,
          });
        }
      } catch (err) {
        console.error('Invalid client WS payload:', err);
      }
    });

    clientWs.on('close', () => {
      closed = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
    });

    clientWs.on('error', () => {
      closed = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url || '/', true);
    if (pathname === '/api/live') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      nextUpgradeHandler(req, socket, head);
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> EventLedger ERP ready on http://${hostname}:${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start EventLedger server:', err);
  process.exit(1);
});
