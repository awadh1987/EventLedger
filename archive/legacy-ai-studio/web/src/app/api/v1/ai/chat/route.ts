import { NextRequest, NextResponse } from 'next/server';
import { ThinkingLevel, type Content } from '@google/genai';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import {
  getGeminiClient,
  getVenueConciergeSystemInstruction,
  mapGeminiError,
} from '@/lib/gemini';
import {
  clearUserChatMessages,
  getUserChatMessages,
  listAllHalls,
  listScheduledEvents,
  saveChatMessageRecord,
} from '@db/bookings.ts';

type ChatMode = 'general' | 'fast' | 'deep';

function resolveChatModel(mode: ChatMode): {
  model: string;
  thinkingLevel?: ThinkingLevel;
} {
  switch (mode) {
    case 'fast':
      return { model: 'gemini-3.1-flash-lite' };
    case 'deep':
      return { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.HIGH };
    case 'general':
    default:
      return { model: 'gemini-4-hydrogen' };
  }
}

async function buildScheduleSnapshot(): Promise<string> {
  try {
    const [halls, events] = await Promise.all([listAllHalls(), listScheduledEvents()]);
    const hallSummary = halls
      .map(
        (h) =>
          `- ${h.nameEn} (${h.nameAr}): Banquet ${h.capacityBanquet}, Theater ${h.capacityTheater}, Base ${h.basePrice} YER, Cleaning buffer ${h.cleaningBufferMinutes}m`
      )
      .join('\n');

    const upcomingSummary = events
      .slice(0, 15)
      .map(
        (e) =>
          `- [${e.eventCode}] ${e.titleEn} (${e.titleAr}) | Hall: ${e.hallNameEn} | Client: ${e.clientNameEn} | ${e.startTime} -> ${e.endTime} | Status: ${e.status} | Guests: ${e.guestCount} | Total: ${e.totalAmount} ${e.currency} (Paid: ${e.paidAmount})`
      )
      .join('\n');

    return `Halls:\n${hallSummary || 'No halls configured'}\n\nScheduled Bookings:\n${upcomingSummary || 'No scheduled bookings'}`;
  } catch {
    return '';
  }
}

export async function GET(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId') || 'default-erp-concierge';
    const messages = await getUserChatMessages(authResult.user.uid, sessionId, 50);
    return NextResponse.json({ sessionId, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load conversation history.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId') || 'default-erp-concierge';
    await clearUserChatMessages(authResult.user.uid, sessionId);
    return NextResponse.json({ cleared: true, sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to clear conversation history.';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    const body = await req.json();
    const message = String(body?.message || '').trim();
    const locale: 'ar' | 'en' = body?.locale === 'en' ? 'en' : 'ar';
    const sessionId = String(body?.sessionId || 'default-erp-concierge').trim() || 'default-erp-concierge';
    const rawMode = String(body?.mode || 'general');
    const mode: ChatMode = rawMode === 'fast' || rawMode === 'deep' ? rawMode : 'general';

    if (!message) {
      return NextResponse.json({ detail: 'Message cannot be empty.' }, { status: 400 });
    }

    const { model, thinkingLevel } = resolveChatModel(mode);
    const [priorMessages, scheduleSnapshot] = await Promise.all([
      getUserChatMessages(authResult.user.uid, sessionId, 24),
      buildScheduleSnapshot(),
    ]);

    const history: Content[] = priorMessages.map((msg) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const ai = getGeminiClient();
    const chat = ai.chats.create({
      model,
      history,
      config: {
        systemInstruction: getVenueConciergeSystemInstruction(locale, scheduleSnapshot),
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    });

    const response = await chat.sendMessage({ message });
    const replyText = (response.text ?? '').trim();

    if (!replyText) {
      return NextResponse.json(
        { detail: 'The assistant returned an empty response. Please try again.' },
        { status: 502 }
      );
    }

    const userSaved = await saveChatMessageRecord({
      sessionId,
      userUid: authResult.user.uid,
      role: 'user',
      model,
      content: message,
    });

    const modelSaved = await saveChatMessageRecord({
      sessionId,
      userUid: authResult.user.uid,
      role: 'model',
      model,
      content: replyText,
    });

    return NextResponse.json({
      sessionId,
      model,
      mode,
      userMessage: userSaved,
      assistantMessage: modelSaved,
    });
  } catch (error) {
    console.error('Gemini chat endpoint error:', error);
    const mapped = mapGeminiError(error);
    return NextResponse.json({ detail: mapped.message }, { status: mapped.status });
  }
}
