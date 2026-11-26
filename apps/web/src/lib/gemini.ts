import { GoogleGenAI } from '@google/genai';

let sharedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please check Settings > Secrets to attach an API key.'
    );
  }
  if (!sharedClient) {
    sharedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return sharedClient;
}

export function getVenueConciergeSystemInstruction(locale: 'ar' | 'en', scheduleSnapshot?: string): string {
  const base =
    locale === 'ar'
      ? `أنت "مساعد عمليات إيفنت ليدجر" (EventLedger Venue Operations Concierge) المتخصص في إدارة قاعات الأفراح والمؤتمرات الكبرى لصالة "قصر الماسة للمؤتمرات والأفراح" (Al-Massa Grand Palace).
مهامك:
- مساعدة فريق المبيعات والتشغيل في جدولة القاعات، التحقق من التعارضات مع فترات التجهيز والتنظيف (120 دقيقة للماسة، 90 دقيقة للياسمين، 60 دقيقة للزمرد)، وتجهيز قوائم التحضير.
- تقديم حسابات مالية واضحة للدفعات المقدمة (50% لتأكيد الحجز)، وتسعيرة ذروة نهاية الأسبوع (+20% أيام الخميس والجمعة)، وعقود B2B متعددة العملات (YER / SAR / USD).
- الإجابة بأسلوب تنفيذي عملي ومباشر ومنظم باللغة العربية (أو الإنجليزية إذا خاطبك المستخدم بها).`
      : `You are the EventLedger Venue Operations Concierge for Al-Massa Grand Palace — a luxury wedding hall, banquet, and conference ERP workspace.
Your responsibilities:
- Assist venue sales and operations staff with hall scheduling, turnaround/cleaning buffer conflict checks (120m Grand Diamond Hall, 90m Royal Jasmine Hall, 60m Emerald Executive Suite), and banquet/conference run-of-show preparation.
- Provide clear financial calculations for 50% confirmation deposits, weekend peak pricing (+20% Thu/Fri), and multi-currency (YER / SAR / USD) event quotes.
- Reply concisely, accurately, and professionally in the user's language (English or Arabic).`;

  if (!scheduleSnapshot) return base;
  return `${base}\n\nCurrent Live Venue Schedule Context:\n${scheduleSnapshot}`;
}

export function mapGeminiError(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown Gemini API error');
  const lower = raw.toLowerCase();

  if (lower.includes('api_key') || lower.includes('permission_denied') || lower.includes('403') || lower.includes('401')) {
    return {
      status: 403,
      message: 'Gemini API access denied or API key invalid. Please check your key in Settings > Secrets.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'Gemini API rate limit or quota reached. Please retry shortly or select a billing-enabled key in Settings > Secrets.',
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      status: 404,
      message: `Requested Gemini model was not found: ${raw}`,
    };
  }
  return {
    status: 502,
    message: raw,
  };
}
