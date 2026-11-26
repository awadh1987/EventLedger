import { asc, desc, eq, and } from 'drizzle-orm';
import { db } from './index.ts';
import {
  chatMessages,
  events,
  halls,
  tenants,
  type GroundingLinkRecord,
} from './schema.ts';

export interface HallSeed {
  id: string;
  nameEn: string;
  nameAr: string;
  capacityBanquet: number;
  capacityTheater: number;
  basePrice: number;
  cleaningBufferMinutes: number;
}

export interface EventSeed {
  id: string;
  eventCode: string;
  hallId: string;
  titleEn: string;
  titleAr: string;
  eventType: string;
  clientNameEn: string;
  clientNameAr: string;
  clientPhone: string;
  assignedSalesEn: string;
  assignedSalesAr: string;
  startTime: string;
  endTime: string;
  cleaningBufferMinutes: number;
  status: string;
  guestCount: number;
  totalAmount: number;
  paidAmount: number;
  currency: string;
  notesEn: string;
  notesAr: string;
}

export async function ensureSeededVenueData(
  seedHalls: HallSeed[],
  seedEvents: EventSeed[]
) {
  try {
    const existingHalls = await db.select({ id: halls.id }).from(halls).limit(1);
    if (existingHalls.length === 0 && seedHalls.length > 0) {
      await db.insert(halls).values(seedHalls).onConflictDoNothing();
    }

    const existingEvents = await db.select({ id: events.id }).from(events).limit(1);
    if (existingEvents.length === 0 && seedEvents.length > 0) {
      await db.insert(events).values(seedEvents).onConflictDoNothing();
    }
  } catch (error) {
    console.error('Database venue seed check failed:', error);
    throw new Error('Unable to initialize venue schedule records.', { cause: error });
  }
}

export async function listAllHalls() {
  try {
    return await db.select().from(halls).orderBy(asc(halls.id));
  } catch (error) {
    console.error('Database query failed (listAllHalls):', error);
    throw new Error('Unable to load venue halls.', { cause: error });
  }
}

export async function listScheduledEvents(filters?: {
  hallId?: string | null;
  status?: string | null;
}) {
  try {
    const conditions = [];
    if (filters?.hallId && filters.hallId !== 'ALL') {
      conditions.push(eq(events.hallId, filters.hallId));
    }
    if (filters?.status && filters.status !== 'ALL') {
      conditions.push(eq(events.status, filters.status));
    }

    const rows =
      conditions.length > 0
        ? await db
            .select({
              event: events,
              hallNameEn: halls.nameEn,
              hallNameAr: halls.nameAr,
            })
            .from(events)
            .innerJoin(halls, eq(events.hallId, halls.id))
            .where(and(...conditions))
            .orderBy(asc(events.startTime))
        : await db
            .select({
              event: events,
              hallNameEn: halls.nameEn,
              hallNameAr: halls.nameAr,
            })
            .from(events)
            .innerJoin(halls, eq(events.hallId, halls.id))
            .orderBy(asc(events.startTime));

    return rows.map(({ event, hallNameEn, hallNameAr }) => ({
      id: event.id,
      eventCode: event.eventCode,
      titleEn: event.titleEn,
      titleAr: event.titleAr,
      eventType: event.eventType,
      hallId: event.hallId,
      hallNameEn,
      hallNameAr,
      clientNameEn: event.clientNameEn,
      clientNameAr: event.clientNameAr,
      clientPhone: event.clientPhone,
      assignedSalesEn: event.assignedSalesEn,
      assignedSalesAr: event.assignedSalesAr,
      startTime: event.startTime,
      endTime: event.endTime,
      cleaningBufferMinutes: event.cleaningBufferMinutes,
      status: event.status,
      guestCount: event.guestCount,
      totalAmount: event.totalAmount,
      paidAmount: event.paidAmount,
      currency: event.currency,
      notesEn: event.notesEn,
      notesAr: event.notesAr,
    }));
  } catch (error) {
    console.error('Database query failed (listScheduledEvents):', error);
    throw new Error('Unable to load scheduled events.', { cause: error });
  }
}

export async function findHallById(hallId: string) {
  try {
    const rows = await db.select().from(halls).where(eq(halls.id, hallId)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (findHallById):', error);
    throw new Error('Unable to look up selected hall.', { cause: error });
  }
}

export async function findDbScheduleConflict(
  hallId: string,
  startIso: string,
  endIso: string,
  cleaningBufferMinutes: number,
  excludeEventId?: string
) {
  try {
    const hallEvents = await db
      .select()
      .from(events)
      .where(eq(events.hallId, hallId));

    const newStart = new Date(startIso).getTime();
    const newEndWithBuffer = new Date(endIso).getTime() + cleaningBufferMinutes * 60 * 1000;

    for (const ev of hallEvents) {
      if (ev.id === excludeEventId) continue;
      if (ev.status === 'CANCELLED') continue;

      const existingStart = new Date(ev.startTime).getTime();
      const existingEndWithBuffer =
        new Date(ev.endTime).getTime() + ev.cleaningBufferMinutes * 60 * 1000;

      if (newStart < existingEndWithBuffer && existingStart < newEndWithBuffer) {
        return ev;
      }
    }
    return null;
  } catch (error) {
    console.error('Database query failed (findDbScheduleConflict):', error);
    throw new Error('Unable to validate hall schedule availability.', { cause: error });
  }
}

export async function insertBookingEvent(
  record: EventSeed & { createdByUid?: string | null }
) {
  try {
    const [inserted] = await db
      .insert(events)
      .values({
        ...record,
        createdByUid: record.createdByUid ?? null,
      })
      .returning();
    return inserted;
  } catch (error) {
    console.error('Database insert failed (insertBookingEvent):', error);
    throw new Error('Unable to save booking event.', { cause: error });
  }
}

export async function updateBookingEventStatus(id: string, nextStatus: string) {
  try {
    const existingRows = await db.select().from(events).where(eq(events.id, id)).limit(1);
    const existing = existingRows[0];
    if (!existing) {
      return null;
    }

    const nextPaidAmount =
      nextStatus === 'CONFIRMED' && existing.paidAmount === 0
        ? Math.round(existing.totalAmount * 0.5)
        : existing.paidAmount;

    const [updated] = await db
      .update(events)
      .set({
        status: nextStatus,
        paidAmount: nextPaidAmount,
      })
      .where(eq(events.id, id))
      .returning();

    const hall = await findHallById(updated.hallId);
    return {
      ...updated,
      hallNameEn: hall?.nameEn ?? updated.hallId,
      hallNameAr: hall?.nameAr ?? updated.hallId,
    };
  } catch (error) {
    console.error('Database update failed (updateBookingEventStatus):', error);
    throw new Error('Unable to update booking status.', { cause: error });
  }
}

export async function findTenantBySlug(slug: string) {
  try {
    const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (findTenantBySlug):', error);
    throw new Error('Unable to verify workspace subdomain availability.', { cause: error });
  }
}

export async function createTenantRecord(input: {
  slug: string;
  venueName: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string | null;
  currency: string;
  subscriptionTier: string;
  ownerUid: string;
}) {
  try {
    const [inserted] = await db.insert(tenants).values(input).returning();
    return inserted;
  } catch (error) {
    console.error('Database insert failed (createTenantRecord):', error);
    throw new Error('Unable to register venue workspace.', { cause: error });
  }
}

export async function getUserChatMessages(userUid: string, sessionId: string, limit = 40) {
  try {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.userUid, userUid), eq(chatMessages.sessionId, sessionId)))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(limit);
    return rows.reverse();
  } catch (error) {
    console.error('Database query failed (getUserChatMessages):', error);
    throw new Error('Unable to load conversation history.', { cause: error });
  }
}

export async function saveChatMessageRecord(input: {
  sessionId: string;
  userUid: string;
  role: 'user' | 'model';
  model: string;
  content: string;
  groundingLinks?: GroundingLinkRecord[] | null;
}) {
  try {
    const [inserted] = await db
      .insert(chatMessages)
      .values({
        sessionId: input.sessionId,
        userUid: input.userUid,
        role: input.role,
        model: input.model,
        content: input.content,
        groundingLinks: input.groundingLinks ?? null,
      })
      .returning();
    return inserted;
  } catch (error) {
    console.error('Database insert failed (saveChatMessageRecord):', error);
    throw new Error('Unable to save chat message.', { cause: error });
  }
}

export async function clearUserChatMessages(userUid: string, sessionId: string) {
  try {
    await db
      .delete(chatMessages)
      .where(and(eq(chatMessages.userUid, userUid), eq(chatMessages.sessionId, sessionId)));
  } catch (error) {
    console.error('Database delete failed (clearUserChatMessages):', error);
    throw new Error('Unable to reset conversation history.', { cause: error });
  }
}
