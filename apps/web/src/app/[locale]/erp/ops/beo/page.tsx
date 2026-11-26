'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, ClipboardList, MessageSquare, Send } from 'lucide-react';
import { OperationsBeoPanel } from '@/components/erp/OperationsBeoPanel';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAuth } from '@/components/providers/auth-provider';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';
import type { ScheduledEvent } from '@/lib/bookings-store';

interface ThreadMessage {
  id: string;
  sender: string;
  channel: 'IN_APP' | 'WHATSAPP';
  department: 'ALL' | 'KITCHEN' | 'AV' | 'SECURITY' | 'FINANCE';
  content: string;
  isInternal: boolean;
  timestamp: string;
}

const FALLBACK_BEO_ORDERS = [
  {
    id: 'EVT-2026-101',
    eventCode: 'EVT-2026-101',
    titleAr: 'حفل زفاف آل الشامي الملكي',
    titleEn: 'Al-Shami Royal Wedding Reception',
    hallNameAr: 'قاعة الماسة الكبرى',
    hallNameEn: 'Grand Diamond Hall',
    guestCount: 250,
    notesAr: 'بوفيه ملكي 250 ضيف · كوشة ملكية · طاولتان VIP إضافية · تجهيز الصوت والإضاءة الساعة 15:00.',
    notesEn: 'Royal Banquet Buffet for 250 guests · Royal Kosha stage · 2 extra VIP tables · AV check at 15:00.',
  },
  {
    id: 'EVT-2026-102',
    eventCode: 'EVT-2026-102',
    titleAr: 'مؤتمر التقنية المالية السنوي',
    titleEn: 'Annual FinTech Executive Summit',
    hallNameAr: 'قاعة المؤتمرات الدولية',
    hallNameEn: 'International Conference Hall',
    guestCount: 180,
    notesAr: 'ترتيب مسرحي · شاشات عرض مزدوجة · استراحة قهوة عربية وضيافة صباحية.',
    notesEn: 'Theater seating · Dual LED projection · Morning Arabic coffee & executive catering break.',
  },
];

export default function LiveBeoOpsPage() {
  const params = useParams<{ locale?: string }>();
  const locale: 'ar' | 'en' = params?.locale === 'en' ? 'en' : 'ar';
  const isRtl = locale === 'ar';
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const { user, authFetch } = useAuth();

  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [messages, setMessages] = useState<ThreadMessage[]>([
    {
      id: 'm1',
      sender: 'Head Chef (الشيف التنفيذي)',
      channel: 'IN_APP',
      department: 'KITCHEN',
      content: isRtl
        ? '@KITCHEN تم اعتماد 250 ضيف لبوفيه قاعة الماسة الكبرى مع طاولتي VIP إضافية.'
        : '@KITCHEN Confirmed 250 guests for Grand Diamond Hall Royal Buffet + 2 extra VIP tables.',
      isInternal: true,
      timestamp: '18:20',
    },
    {
      id: 'm2',
      sender: 'Ahmed Al-Shami (WhatsApp Cloud API)',
      channel: 'WHATSAPP',
      department: 'ALL',
      content: isRtl
        ? 'تم تحويل عربون الحجز عبر بنك الكريمي وإرفاق سند التحويل.'
        : 'Deposit transferred via Al-Kuraimi Islamic Bank; receipt uploaded.',
      isInternal: false,
      timestamp: '18:42',
    },
  ]);
  const [dept, setDept] = useState<ThreadMessage['department']>('KITCHEN');
  const [isInternal, setIsInternal] = useState(true);
  const [msgText, setMsgText] = useState('');

  useEffect(() => {
    if (!user) return;
    authFetch('/api/v1/bookings/events')
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(Array.isArray(d?.events) ? d.events : []))
      .catch(() => undefined);
  }, [user, authFetch]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgText.trim()) return;
    setMessages((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}`,
        sender: isRtl ? 'مشرف العمليات (Ops Manager)' : 'Ops Manager',
        channel: 'IN_APP',
        department: dept,
        content: `@${dept} ${msgText.trim()}`,
        isInternal,
        timestamp: new Date().toTimeString().slice(0, 5),
      },
    ]);
    setMsgText('');
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/${locale}/dashboard`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200"
            >
              <BackIcon className="h-3.5 w-3.5" />
              <span>{isRtl ? 'لوحة العمليات' : 'ERP Console'}</span>
            </Link>
            <SpotlightHeading as="h1" className="text-lg">
              {isRtl ? 'شاشة أوامر التشغيل المباشرة للمطبخ والقاعات (Live BEO)' : 'Live Kitchen & Hall Banquet Event Orders (BEO)'}
            </SpotlightHeading>
          </div>
          <Link
            href={`/${locale === 'ar' ? 'en' : 'ar'}/erp/ops/beo`}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300"
          >
            {isRtl ? 'English' : 'العربية'}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-6">
        {user ? (
          <OperationsBeoPanel locale={locale} events={events} />
        ) : (
          <SpotlightCard className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
              <ClipboardList className="h-4 w-4 text-amber-500" />
              <SpotlightHeading as="h2" className="text-base">
                {isRtl ? 'أوامر التشغيل المباشرة للقاعات والمطبخ (Live BEO)' : 'Live Kitchen & Banquet Event Orders (BEO)'}
              </SpotlightHeading>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {FALLBACK_BEO_ORDERS.map((ev) => (
                <div key={ev.id} className="space-y-1.5 py-3.5 text-xs first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {isRtl ? ev.titleAr : ev.titleEn}
                    </span>
                    <span className="font-mono text-[11px] text-amber-600 dark:text-[#D4AF37]">
                      {ev.eventCode} · {isRtl ? ev.hallNameAr : ev.hallNameEn} · {ev.guestCount}{' '}
                      {isRtl ? 'ضيف' : 'guests'}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400">{isRtl ? ev.notesAr : ev.notesEn}</p>
                </div>
              ))}
            </div>
          </SpotlightCard>
        )}

        {/* Unified EventMessage & Two-Way WhatsApp Comms Thread */}
        <SpotlightCard className="space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-amber-500" />
            <SpotlightHeading as="h2" className="text-base">
              {isRtl
                ? 'مركز تواصل الأقسام الموحد ورسائل واتساب للأعمال (@Department + WhatsApp)'
                : 'Unified EventMessage Comms & WhatsApp Cloud Webhook Thread'}
            </SpotlightHeading>
          </div>

          <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/70">
            {messages.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200/80 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{m.sender}</span>
                    <span className="font-mono text-[11px] font-semibold text-amber-600 dark:text-[#D4AF37]">
                      @{m.department}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">{m.channel}</span>
                    {m.isInternal && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {isRtl ? 'ملاحظة داخلية للموظفين' : 'INTERNAL STAFF NOTE'}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">{m.content}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400">{m.timestamp}</span>
              </div>
            ))}
          </div>

          <form onSubmit={handleSendMessage} className="flex flex-wrap items-center gap-3">
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value as ThreadMessage['department'])}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
            >
              <option value="KITCHEN">@KITCHEN</option>
              <option value="AV">@AV</option>
              <option value="SECURITY">@SECURITY</option>
              <option value="FINANCE">@FINANCE</option>
              <option value="ALL">@ALL</option>
            </select>
            <label className="inline-flex min-h-[44px] items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              <span>{isRtl ? 'داخلي للموظفين فقط' : 'Internal Staff Only'}</span>
            </label>
            <input
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder={isRtl ? 'اكتب توجيه القسم أو رسالة واتساب للعميل...' : 'Type department directive or client WhatsApp message...'}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-800 dark:bg-slate-950"
            />
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--brand-primary,#D4AF37)] px-4 text-xs font-semibold text-slate-950"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isRtl ? 'إرسال' : 'Send'}</span>
            </button>
          </form>
        </SpotlightCard>
      </main>

      <MobileBottomNav persona="ERP_STAFF" locale={locale} />
    </div>
  );
}
