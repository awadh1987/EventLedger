import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseAuth } from '@/lib/firebase-admin';
import { getGeminiClient, mapGeminiError } from '@/lib/gemini';

export interface MapsPlaceLink {
  title: string;
  uri: string;
  reviewSnippets: Array<{
    text: string;
    uri?: string;
    author?: string;
  }>;
}

interface RawGroundingChunk {
  maps?: {
    uri?: string;
    title?: string;
    placeId?: string;
    placeAnswerSources?: {
      reviewSnippets?: Array<{
        content?: string;
        text?: string;
        googleMapsUri?: string;
        uri?: string;
        reviewUri?: string;
        author?: string;
      }>;
    };
  };
  web?: {
    uri?: string;
    title?: string;
  };
}

export async function POST(req: NextRequest) {
  const authResult = await verifyFirebaseAuth(req);
  if ('error' in authResult) {
    return NextResponse.json({ detail: authResult.error }, { status: authResult.status });
  }

  try {
    const body = await req.json();
    const query = String(body?.query || '').trim();
    const locale: 'ar' | 'en' = body?.locale === 'en' ? 'en' : 'ar';
    const latitude = typeof body?.latitude === 'number' && Number.isFinite(body.latitude) ? body.latitude : null;
    const longitude = typeof body?.longitude === 'number' && Number.isFinite(body.longitude) ? body.longitude : null;
    const locationLabel = typeof body?.locationLabel === 'string' ? body.locationLabel.trim() : '';

    if (!query) {
      return NextResponse.json({ detail: 'Location query cannot be empty.' }, { status: 400 });
    }

    const ai = getGeminiClient();
    const promptPrefix =
      locale === 'ar'
        ? `أنت مساعد لوجستيات ومواقع قاعات الأفراح والمؤتمرات لصالة قصر الماسة. أجب باللغة العربية بشكل منظم مع أبرز الأماكن والملاحظات العملية للضيوف أو منظمي الحفلات${locationLabel ? ` بالقرب من ${locationLabel}` : ''}:\n`
        : `You are a venue logistics and location assistant for Al-Massa Grand Palace. Provide concise, practical venue-planning recommendations with clear place details${locationLabel ? ` near ${locationLabel}` : ''}:\n`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `${promptPrefix}${query}`,
      config: {
        tools: [{ googleMaps: {} }],
        ...(latitude !== null && longitude !== null
          ? {
              toolConfig: {
                retrievalConfig: {
                  latLng: {
                    latitude,
                    longitude,
                  },
                },
              },
            }
          : {}),
      },
    });

    const rawChunks = (response.candidates?.[0]?.groundingMetadata?.groundingChunks ??
      []) as RawGroundingChunk[];

    const seen = new Set<string>();
    const places: MapsPlaceLink[] = [];

    for (const chunk of rawChunks) {
      if (chunk.maps?.uri) {
        const uri = chunk.maps.uri;
        if (seen.has(uri)) continue;
        seen.add(uri);

        const rawSnippets = chunk.maps.placeAnswerSources?.reviewSnippets ?? [];
        const reviewSnippets = rawSnippets
          .map((s) => ({
            text: (s.content || s.text || '').trim(),
            uri: s.googleMapsUri || s.reviewUri || s.uri,
            author: s.author,
          }))
          .filter((s) => s.text.length > 0 || Boolean(s.uri));

        places.push({
          title: chunk.maps.title || 'Google Maps Place',
          uri,
          reviewSnippets,
        });
      } else if (chunk.web?.uri) {
        const uri = chunk.web.uri;
        if (seen.has(uri)) continue;
        seen.add(uri);
        places.push({
          title: chunk.web.title || uri,
          uri,
          reviewSnippets: [],
        });
      }
    }

    return NextResponse.json({
      model: 'gemini-4-hydrogen',
      text: (response.text ?? '').trim(),
      places,
    });
  } catch (error) {
    console.error('Gemini Maps grounding endpoint error:', error);
    const mapped = mapGeminiError(error);
    return NextResponse.json({ detail: mapped.message }, { status: mapped.status });
  }
}
