import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateVenueQuote, hasScheduleOverlap, isWeekendPeakDate } from './pricing-quote';

test('isWeekendPeakDate flags Thursday and Friday as peak days', () => {
  // 2026-11-26 is Thursday, 2026-11-27 is Friday, 2026-11-28 is Saturday
  assert.equal(isWeekendPeakDate('2026-11-26', '17:00'), true);
  assert.equal(isWeekendPeakDate('2026-11-27', '17:00'), true);
  assert.equal(isWeekendPeakDate('2026-11-28', '17:00'), false);
  assert.equal(isWeekendPeakDate('', '17:00'), false);
});

test('calculateVenueQuote computes weekday hall + catering + addons + tax + 50% deposit accurately', () => {
  const quote = calculateVenueQuote({
    hallBasePrice: 1000000,
    eventDate: '2026-11-28', // Saturday (weekday rate)
    startHour: '17:00',
    guestCount: 200,
    cateringPricePerGuest: 5000,
    addons: [
      { unitPrice: 1500, quantity: 30 },
      { unitPrice: 120000, quantity: 1 },
    ],
    taxRate: 5,
    defaultSecurityDeposit: 150000,
  });

  assert.equal(quote.isWeekendPeak, false);
  assert.equal(quote.hallTotal, 1000000);
  assert.equal(quote.cateringTotal, 1000000);
  assert.equal(quote.addonsTotal, 165000);
  assert.equal(quote.subtotal, 2165000);
  assert.equal(quote.taxAmount, 108250);
  assert.equal(quote.grandTotal, 2273250);
  assert.equal(quote.confirmationDeposit, 1136625);
  assert.equal(quote.securityDeposit, 150000);
});

test('calculateVenueQuote applies +20% weekend peak multiplier on Thursday/Friday', () => {
  const quote = calculateVenueQuote({
    hallBasePrice: 1500000,
    eventDate: '2026-11-26', // Thursday
    startHour: '18:00',
    guestCount: 100,
    taxRate: 5,
    defaultSecurityDeposit: 150000,
  });

  assert.equal(quote.isWeekendPeak, true);
  assert.equal(quote.hallTotal, 1800000);
  assert.equal(quote.taxAmount, 90000);
  assert.equal(quote.grandTotal, 1890000);
  assert.equal(quote.confirmationDeposit, 945000);
});

test('hasScheduleOverlap enforces cleaning buffer and ignores cancelled events', () => {
  const existing = {
    startTime: '2026-12-01T14:00:00Z',
    endTime: '2026-12-01T18:00:00Z',
    cleaningBufferMinutes: 120,
    status: 'CONFIRMED',
  };

  // Starts at 19:00 while buffer extends to 20:00 -> conflict!
  assert.equal(
    hasScheduleOverlap(
      {
        startTime: '2026-12-01T19:00:00Z',
        endTime: '2026-12-01T22:00:00Z',
        cleaningBufferMinutes: 60,
      },
      existing
    ),
    true
  );

  // Starts cleanly at 20:00 -> no conflict
  assert.equal(
    hasScheduleOverlap(
      {
        startTime: '2026-12-01T20:00:00Z',
        endTime: '2026-12-01T23:00:00Z',
        cleaningBufferMinutes: 60,
      },
      existing
    ),
    false
  );

  // Cancelled existing booking never blocks
  assert.equal(
    hasScheduleOverlap(
      {
        startTime: '2026-12-01T15:00:00Z',
        endTime: '2026-12-01T17:00:00Z',
        cleaningBufferMinutes: 60,
      },
      { ...existing, status: 'CANCELLED' }
    ),
    false
  );
});
