import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LOOKUPS: Record<string, { code: string; labelAr: string; labelEn: string }[]> = {
  EVENT_TYPE: [
    { code: 'WEDDING', labelAr: 'حفل زفاف ملكي', labelEn: 'Wedding Reception' },
    { code: 'CONFERENCE', labelAr: 'مؤتمر رسمي', labelEn: 'Executive Conference' },
    { code: 'GALA', labelAr: 'عشاء رسمي', labelEn: 'Gala Dinner' },
    { code: 'CORPORATE', labelAr: 'فعالية شركات', labelEn: 'Corporate Event' },
  ],
  REFUND_CHANNEL: [
    { code: 'KURAIMI_BANK', labelAr: 'بنك الكريمي الإسلامي', labelEn: 'Al-Kuraimi Islamic Bank' },
    { code: 'JAIB_WALLET', labelAr: 'محفظة جيب (Jaib)', labelEn: 'Jaib E-Wallet' },
    { code: 'JAWALI_WALLET', labelAr: 'محفظة جوالي (Jawali)', labelEn: 'Jawali E-Wallet' },
    { code: 'ONECASH_WALLET', labelAr: 'محفظة ون كاش (OneCash)', labelEn: 'OneCash Wallet' },
    { code: 'BANK_IBAN', labelAr: 'تحويل بنكي (IBAN)', labelEn: 'Bank IBAN Transfer' },
  ],
  INVENTORY_CATEGORY: [
    { code: 'FURNITURE', labelAr: 'أثاث وطاولات', labelEn: 'Furniture & Seating' },
    { code: 'AV_LIGHTING', labelAr: 'صوتيات وإضاءة', labelEn: 'AV & Stage Lighting' },
    { code: 'DECOR', labelAr: 'كوشات وديكور', labelEn: 'Kosha & Floral Decor' },
    { code: 'CONFERENCE', labelAr: 'تجهيزات مؤتمرات', labelEn: 'Conference Equipment' },
  ],
};

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category')?.toUpperCase();
  if (category && DEFAULT_LOOKUPS[category]) {
    return NextResponse.json({ category, lookups: DEFAULT_LOOKUPS[category] });
  }
  return NextResponse.json({ lookupsByCategory: DEFAULT_LOOKUPS });
}
