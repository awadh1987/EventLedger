export interface QuoteAddonInput {
  unitPrice: number;
  quantity: number;
}

export interface VenueQuoteInput {
  hallBasePrice: number;
  eventDate: string;
  startHour: string;
  guestCount: number;
  cateringPricePerGuest?: number;
  addons?: QuoteAddonInput[];
  taxRate: number;
  defaultSecurityDeposit: number;
}

export interface VenueQuoteResult {
  isWeekendPeak: boolean;
  hallTotal: number;
  cateringTotal: number;
  addonsTotal: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  confirmationDeposit: number;
  securityDeposit: number;
}

export function isWeekendPeakDate(eventDate: string, startHour = '17:00'): boolean {
  if (!eventDate) return false;
  const dt = new Date(`${eventDate}T${startHour}:00`);
  if (Number.isNaN(dt.getTime())) return false;
  const dow = dt.getDay();
  // Thursday (4) or Friday (5) in regional hospitality calendar
  return dow === 4 || dow === 5;
}

export function calculateVenueQuote(input: VenueQuoteInput): VenueQuoteResult {
  const isWeekendPeak = isWeekendPeakDate(input.eventDate, input.startHour);
  const hallTotal = Math.round(Math.max(0, input.hallBasePrice) * (isWeekendPeak ? 1.2 : 1.0));
  const safeGuests = Math.max(0, Math.round(input.guestCount || 0));
  const cateringTotal =
    input.cateringPricePerGuest && input.cateringPricePerGuest > 0
      ? Math.round(input.cateringPricePerGuest * safeGuests)
      : 0;
  const addonsTotal = (input.addons || []).reduce((sum, item) => {
    const qty = Math.max(0, Math.round(item.quantity || 0));
    const unit = Math.max(0, Math.round(item.unitPrice || 0));
    return sum + qty * unit;
  }, 0);

  const subtotal = hallTotal + cateringTotal + addonsTotal;
  const taxRate = Math.max(0, input.taxRate ?? 0);
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  const grandTotal = subtotal + taxAmount;
  const confirmationDeposit = Math.round(grandTotal * 0.5);
  const securityDeposit = Math.max(0, Math.round(input.defaultSecurityDeposit || 0));

  return {
    isWeekendPeak,
    hallTotal,
    cateringTotal,
    addonsTotal,
    subtotal,
    taxRate,
    taxAmount,
    grandTotal,
    confirmationDeposit,
    securityDeposit,
  };
}

export interface ScheduleWindow {
  startTime: string;
  endTime: string;
  cleaningBufferMinutes: number;
  status?: string;
}

export function hasScheduleOverlap(candidate: ScheduleWindow, existing: ScheduleWindow): boolean {
  if (existing.status === 'CANCELLED') return false;
  const candStart = new Date(candidate.startTime).getTime();
  const candEnd = new Date(candidate.endTime).getTime() + candidate.cleaningBufferMinutes * 60 * 1000;
  const exStart = new Date(existing.startTime).getTime();
  const exEnd = new Date(existing.endTime).getTime() + existing.cleaningBufferMinutes * 60 * 1000;
  if (Number.isNaN(candStart) || Number.isNaN(candEnd) || Number.isNaN(exStart) || Number.isNaN(exEnd)) {
    return false;
  }
  return candStart < exEnd && exStart < candEnd;
}
