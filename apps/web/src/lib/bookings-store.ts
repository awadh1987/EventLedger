export type EventStatus =
  | 'INQUIRY'
  | 'HOLD_48H'
  | 'CONTRACT_PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED';

export type EventType =
  | 'WEDDING'
  | 'CONFERENCE'
  | 'GALA_DINNER'
  | 'CORPORATE_SUMMIT'
  | 'GRADUATION';

export interface HallInfo {
  id: string;
  nameEn: string;
  nameAr: string;
  capacityBanquet: number;
  capacityTheater: number;
  basePrice: number;
  cleaningBufferMinutes: number;
}

export interface ScheduledEvent {
  id: string;
  eventCode: string;
  titleEn: string;
  titleAr: string;
  eventType: EventType;
  hallId: string;
  hallNameEn: string;
  hallNameAr: string;
  clientNameEn: string;
  clientNameAr: string;
  clientPhone: string;
  assignedSalesEn: string;
  assignedSalesAr: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
  cleaningBufferMinutes: number;
  status: EventStatus;
  guestCount: number;
  totalAmount: number;
  paidAmount: number;
  currency: string;
  notesEn: string;
  notesAr: string;
}

export const VENUE_HALLS: HallInfo[] = [
  {
    id: 'hall-diamond',
    nameEn: 'Grand Diamond Hall',
    nameAr: 'قاعة الماسة الكبرى',
    capacityBanquet: 500,
    capacityTheater: 800,
    basePrice: 1500000,
    cleaningBufferMinutes: 120,
  },
  {
    id: 'hall-jasmine',
    nameEn: 'Royal Jasmine Hall',
    nameAr: 'قاعة الياسمين الملكية',
    capacityBanquet: 300,
    capacityTheater: 450,
    basePrice: 950000,
    cleaningBufferMinutes: 90,
  },
  {
    id: 'hall-emerald',
    nameEn: 'Emerald Executive Suite',
    nameAr: 'جناح الزمرد التنفيذي',
    capacityBanquet: 140,
    capacityTheater: 220,
    basePrice: 520000,
    cleaningBufferMinutes: 60,
  },
];

function makeIsoOffset(dayOffset: number, startHour: number, durationHours: number): { startTime: string; endTime: string } {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, startHour, 0, 0, 0);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

export function buildInitialEvents(): ScheduledEvent[] {
  const diamond = VENUE_HALLS[0];
  const jasmine = VENUE_HALLS[1];
  const emerald = VENUE_HALLS[2];

  const seeds: Array<
    Omit<ScheduledEvent, 'startTime' | 'endTime' | 'hallNameEn' | 'hallNameAr' | 'cleaningBufferMinutes'> & {
      hall: HallInfo;
      dayOffset: number;
      startHour: number;
      durationHours: number;
    }
  > = [
    {
      id: 'evt-1000',
      eventCode: 'EVT-2026-1000',
      titleEn: 'Al-Khatib Family Reception',
      titleAr: 'حفل استقبال عائلة الخطيب',
      eventType: 'WEDDING',
      hall: jasmine,
      hallId: jasmine.id,
      clientNameEn: 'Saeed Al-Khatib',
      clientNameAr: 'سعيد الخطيب',
      clientPhone: '+967771204411',
      assignedSalesEn: 'Tariq Al-Mansoor',
      assignedSalesAr: 'أ. طارق المنصور',
      dayOffset: -2,
      startHour: 17,
      durationHours: 5,
      status: 'COMPLETED',
      guestCount: 260,
      totalAmount: 1090000,
      paidAmount: 1090000,
      currency: 'YER',
      notesEn: 'Full royal buffet completed; security deposit released after hall inspection.',
      notesAr: 'اكتمل البوفيه الملكي وتم تحرير مبلغ التأمين بعد معاينة القاعة.',
    },
    {
      id: 'evt-1001',
      eventCode: 'EVT-2026-1001',
      titleEn: 'Al-Shami Royal Wedding Banquet',
      titleAr: 'حفل زفاف آل الشامي الملكي',
      eventType: 'WEDDING',
      hall: diamond,
      hallId: diamond.id,
      clientNameEn: 'Ahmed Abdullah Al-Shami',
      clientNameAr: 'أحمد عبدالله الشامي',
      clientPhone: '+967771112233',
      assignedSalesEn: 'Tariq Al-Mansoor',
      assignedSalesAr: 'أ. طارق المنصور',
      dayOffset: 0,
      startHour: 16,
      durationHours: 6,
      status: 'CONFIRMED',
      guestCount: 420,
      totalAmount: 1575000,
      paidAmount: 787500,
      currency: 'YER',
      notesEn: 'VIP stage lighting + 30 extra Royal Gold Chiavari chairs pending final client sign-off.',
      notesAr: 'إضاءة المسرح الملكي مع طلب إضافي لـ 30 كرسي شيافاري ذهبي بانتظار الاعتماد النهائي.',
    },
    {
      id: 'evt-1002',
      eventCode: 'EVT-2026-1002',
      titleEn: 'Yemen FinTech & Payments Forum',
      titleAr: 'منتدى التقنية المالية والمدفوعات',
      eventType: 'CONFERENCE',
      hall: emerald,
      hallId: emerald.id,
      clientNameEn: 'Kuraimi Digital Ventures',
      clientNameAr: 'مؤسسة الكريمي الرقمية',
      clientPhone: '+967774509988',
      assignedSalesEn: 'Nadia Al-Harbi',
      assignedSalesAr: 'أ. نادية الحربي',
      dayOffset: 0,
      startHour: 9,
      durationHours: 5,
      status: 'CONFIRMED',
      guestCount: 165,
      totalAmount: 645000,
      paidAmount: 645000,
      currency: 'YER',
      notesEn: 'Theater seating with dual simultaneous translation booths and morning espresso station.',
      notesAr: 'توزيع مسرحي مع كبينتي ترجمة فورية ومحطة ضيافة صباحية.',
    },
    {
      id: 'evt-1003',
      eventCode: 'EVT-2026-1003',
      titleEn: 'Al-Sufiani Engagement Evening',
      titleAr: 'أمسية خطوبة آل السفياني',
      eventType: 'WEDDING',
      hall: jasmine,
      hallId: jasmine.id,
      clientNameEn: 'Khaled Al-Sufiani',
      clientNameAr: 'خالد السفياني',
      clientPhone: '+967772348810',
      assignedSalesEn: 'Tariq Al-Mansoor',
      assignedSalesAr: 'أ. طارق المنصور',
      dayOffset: 2,
      startHour: 17,
      durationHours: 5,
      status: 'HOLD_48H',
      guestCount: 240,
      totalAmount: 1120000,
      paidAmount: 0,
      currency: 'YER',
      notesEn: '48-hour hold expires tomorrow at 18:00; awaiting 50% confirmation deposit via Kuraimi.',
      notesAr: 'ينتهي الحجز المؤقت (48 ساعة) غداً الساعة 18:00 بانتظار دفعة التأكيد 50%.',
    },
    {
      id: 'evt-1004',
      eventCode: 'EVT-2026-1004',
      titleEn: 'National Medical Association Gala',
      titleAr: 'الحفل السنوي لنقابة الأطباء',
      eventType: 'GALA_DINNER',
      hall: diamond,
      hallId: diamond.id,
      clientNameEn: 'Dr. Hisham Al-Qadhi',
      clientNameAr: 'د. هشام القاضي',
      clientPhone: '+967770993321',
      assignedSalesEn: 'Nadia Al-Harbi',
      assignedSalesAr: 'أ. نادية الحربي',
      dayOffset: 4,
      startHour: 18,
      durationHours: 5,
      status: 'CONTRACT_PENDING',
      guestCount: 480,
      totalAmount: 2150000,
      paidAmount: 430000,
      currency: 'YER',
      notesEn: 'B2B corporate contract uploaded; finance reviewing tax-exempt certificate.',
      notesAr: 'تم رفع عقد الجهة؛ الإدارة المالية تراجع شهادة الإعفاء الضريبي.',
    },
    {
      id: 'evt-1005',
      eventCode: 'EVT-2026-1005',
      titleEn: 'Sanaa Engineering Faculty Graduation',
      titleAr: 'حفل تخرج كلية الهندسة',
      eventType: 'GRADUATION',
      hall: diamond,
      hallId: diamond.id,
      clientNameEn: 'Eng. Omar Ba-Wazir',
      clientNameAr: 'م. عمر باوزير',
      clientPhone: '+967776120045',
      assignedSalesEn: 'Yousef Al-Haddad',
      assignedSalesAr: 'أ. يوسف الحداد',
      dayOffset: 6,
      startHour: 10,
      durationHours: 4,
      status: 'CONFIRMED',
      guestCount: 620,
      totalAmount: 1680000,
      paidAmount: 1200000,
      currency: 'YER',
      notesEn: 'Theater layout for 620 attendees; LED backdrop and live camera feed confirmed.',
      notesAr: 'توزيع مسرحي لـ 620 ضيفاً مع شاشة LED رئيسية وتغطية كاميرات مباشرة.',
    },
    {
      id: 'evt-1006',
      eventCode: 'EVT-2026-1006',
      titleEn: 'Red Sea Logistics Executive Summit',
      titleAr: 'قمة البحر الأحمر للخدمات اللوجستية',
      eventType: 'CORPORATE_SUMMIT',
      hall: emerald,
      hallId: emerald.id,
      clientNameEn: 'Huda Al-Mekhlafi',
      clientNameAr: 'هدى المخلافي',
      clientPhone: '+967775812290',
      assignedSalesEn: 'Nadia Al-Harbi',
      assignedSalesAr: 'أ. نادية الحربي',
      dayOffset: 8,
      startHour: 9,
      durationHours: 6,
      status: 'CONFIRMED',
      guestCount: 120,
      totalAmount: 740000,
      paidAmount: 370000,
      currency: 'YER',
      notesEn: 'Boardroom U-shape setup with executive lunch service at 13:00.',
      notesAr: 'تجهيز طاولات على شكل U مع بوفيه غداء تنفيذي الساعة 13:00.',
    },
    {
      id: 'evt-1007',
      eventCode: 'EVT-2026-1007',
      titleEn: 'Al-Baidhani Wedding Celebration',
      titleAr: 'حفل زفاف آل البيضاني',
      eventType: 'WEDDING',
      hall: jasmine,
      hallId: jasmine.id,
      clientNameEn: 'Faisal Al-Baidhani',
      clientNameAr: 'فيصل البيضاني',
      clientPhone: '+967773908765',
      assignedSalesEn: 'Tariq Al-Mansoor',
      assignedSalesAr: 'أ. طارق المنصور',
      dayOffset: 11,
      startHour: 16,
      durationHours: 6,
      status: 'INQUIRY',
      guestCount: 280,
      totalAmount: 1240000,
      paidAmount: 0,
      currency: 'YER',
      notesEn: 'Client requested tasting session for Al-Massa Royal Banquet Buffet.',
      notesAr: 'طلب العميل جلسة تذوق لبوفيه الماسة الملكي قبل تثبيت الحجز.',
    },
    {
      id: 'evt-1008',
      eventCode: 'EVT-2026-1008',
      titleEn: 'Chamber of Commerce Trade Awards',
      titleAr: 'جوائز الغرفة التجارية للاستثمار',
      eventType: 'GALA_DINNER',
      hall: diamond,
      hallId: diamond.id,
      clientNameEn: 'Sanaa Chamber of Commerce',
      clientNameAr: 'الغرفة التجارية الصناعية',
      clientPhone: '+967770441122',
      assignedSalesEn: 'Yousef Al-Haddad',
      assignedSalesAr: 'أ. يوسف الحداد',
      dayOffset: 14,
      startHour: 18,
      durationHours: 5,
      status: 'CONFIRMED',
      guestCount: 460,
      totalAmount: 2380000,
      paidAmount: 1500000,
      currency: 'YER',
      notesEn: 'VIP gate passes enabled (45 dignitaries); valet coordination required.',
      notesAr: 'تفعيل بطاقات كبار الشخصيات QR لـ 45 ضيفاً مع تنسيق خدمة صف السيارات.',
    },
    {
      id: 'evt-1009',
      eventCode: 'EVT-2026-1009',
      titleEn: 'Al-Hamdani Family Banquet',
      titleAr: 'وليمة عائلة الهمداني',
      eventType: 'WEDDING',
      hall: jasmine,
      hallId: jasmine.id,
      clientNameEn: 'Mazen Al-Hamdani',
      clientNameAr: 'مازن الهمداني',
      clientPhone: '+967778123456',
      assignedSalesEn: 'Tariq Al-Mansoor',
      assignedSalesAr: 'أ. طارق المنصور',
      dayOffset: 18,
      startHour: 17,
      durationHours: 5,
      status: 'HOLD_48H',
      guestCount: 290,
      totalAmount: 1320000,
      paidAmount: 0,
      currency: 'YER',
      notesEn: 'Weekend peak multiplier (+20%) applied; awaiting deposit receipt upload.',
      notesAr: 'تم تطبيق تسعيرة ذروة نهاية الأسبوع (+20%) وبانتظار إرفاق سند التحويل.',
    },
    {
      id: 'evt-1010',
      eventCode: 'EVT-2026-1010',
      titleEn: 'Telecom Leaders Strategy Retreat',
      titleAr: 'ملتقى قيادات قطاع الاتصالات',
      eventType: 'CORPORATE_SUMMIT',
      hall: emerald,
      hallId: emerald.id,
      clientNameEn: 'Sabafon Corporate Events',
      clientNameAr: 'فعاليات سبأفون المؤسسية',
      clientPhone: '+967771998877',
      assignedSalesEn: 'Nadia Al-Harbi',
      assignedSalesAr: 'أ. نادية الحربي',
      dayOffset: 22,
      startHour: 8,
      durationHours: 7,
      status: 'CONFIRMED',
      guestCount: 135,
      totalAmount: 810000,
      paidAmount: 810000,
      currency: 'YER',
      notesEn: 'High-speed dedicated fiber uplink + 3 breakout audio zones ready.',
      notesAr: 'توفير خط إنترنت مخصص مع 3 مناطق صوتية لورش العمل.',
    },
    {
      id: 'evt-1011',
      eventCode: 'EVT-2026-1011',
      titleEn: 'Al-Ansi Family Dinner (Cancelled)',
      titleAr: 'حفل عشاء عائلة العنسي (ملغي)',
      eventType: 'WEDDING',
      hall: jasmine,
      hallId: jasmine.id,
      clientNameEn: 'Nabil Al-Ansi',
      clientNameAr: 'نبيل العنسي',
      clientPhone: '+967774112209',
      assignedSalesEn: 'Yousef Al-Haddad',
      assignedSalesAr: 'أ. يوسف الحداد',
      dayOffset: 5,
      startHour: 18,
      durationHours: 4,
      status: 'CANCELLED',
      guestCount: 210,
      totalAmount: 997500,
      paidAmount: 0,
      currency: 'YER',
      notesEn: 'Cancelled by client prior to deposit deadline; hall slot released for re-booking.',
      notesAr: 'تم الإلغاء من قبل العميل قبل موعد سداد الدفعة الأولى وأعيد فتح القاعة للحجز.',
    },
  ];

  return seeds.map(({ hall, dayOffset, startHour, durationHours, ...rest }) => {
    const { startTime, endTime } = makeIsoOffset(dayOffset, startHour, durationHours);
    return {
      ...rest,
      hallNameEn: hall.nameEn,
      hallNameAr: hall.nameAr,
      cleaningBufferMinutes: hall.cleaningBufferMinutes,
      startTime,
      endTime,
    };
  });
}

// Module-level in-memory store persisted across API requests in the running dev server
const globalForBookings = globalThis as unknown as {
  __eventLedgerBookings?: ScheduledEvent[];
};

export function getEventsStore(): ScheduledEvent[] {
  if (!globalForBookings.__eventLedgerBookings) {
    globalForBookings.__eventLedgerBookings = buildInitialEvents();
  }
  return globalForBookings.__eventLedgerBookings;
}

export function findScheduleConflict(
  hallId: string,
  startIso: string,
  endIso: string,
  cleaningBufferMinutes: number,
  excludeEventId?: string
): ScheduledEvent | null {
  const newStart = new Date(startIso).getTime();
  const newEndWithBuffer = new Date(endIso).getTime() + cleaningBufferMinutes * 60 * 1000;

  const events = getEventsStore();
  for (const ev of events) {
    if (ev.id === excludeEventId) continue;
    if (ev.hallId !== hallId) continue;
    if (ev.status === 'CANCELLED') continue;

    const existingStart = new Date(ev.startTime).getTime();
    const existingEndWithBuffer = new Date(ev.endTime).getTime() + ev.cleaningBufferMinutes * 60 * 1000;

    if (newStart < existingEndWithBuffer && existingStart < newEndWithBuffer) {
      return ev;
    }
  }
  return null;
}
