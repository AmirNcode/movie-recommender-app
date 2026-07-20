import { ImageResponse } from 'next/og';
import { getSharedRecommendation } from '@/lib/shared-recommendation';

export const runtime = 'nodejs';
export const alt = 'Filmmoo movie recommendation';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Trims the reason so it fits the card without overflowing. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export default async function OpengraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await getSharedRecommendation(id);

  if (rec?.kind === 'dna' && rec.dna) {
    const dna = rec.dna;
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            backgroundColor: '#0a0a0a',
            color: '#ffffff',
            padding: '80px',
            fontFamily: 'sans-serif',
          }}
        >
          <div
            style={{
              fontSize: '24px',
              letterSpacing: '6px',
              textTransform: 'uppercase',
              color: '#fcd34d',
              marginBottom: '28px',
            }}
          >
            Cinema DNA
          </div>
          <div style={{ fontSize: '72px', fontWeight: 700, lineHeight: 1.1, marginBottom: '28px' }}>
            {dna.archetype}
          </div>
          <div
            style={{
              fontSize: '32px',
              lineHeight: 1.4,
              fontStyle: 'italic',
              color: 'rgba(251,207,232,0.9)',
              marginBottom: '40px',
            }}
          >
            {dna.headline}
          </div>
          <div style={{ display: 'flex', gap: '16px' }}>
            {dna.traits.map((trait) => (
              <div
                key={trait}
                style={{
                  display: 'flex',
                  padding: '12px 24px',
                  borderRadius: '9999px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  fontSize: '24px',
                  color: 'rgba(255,255,255,0.8)',
                }}
              >
                {trait}
              </div>
            ))}
          </div>
        </div>
      ),
      size
    );
  }

  const title = rec ? rec.title : 'Filmmoo';
  const yearSuffix = rec?.year ? ` (${rec.year})` : '';
  const reason = rec?.reason ? truncate(rec.reason, 220) : 'AI-powered movie recommendations based on your taste.';
  const poster = rec?.posterUrl ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#0a0a0a',
          color: '#ffffff',
          padding: '64px',
          fontFamily: 'sans-serif',
        }}
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            width={334}
            height={502}
            style={{
              width: '334px',
              height: '502px',
              objectFit: 'cover',
              borderRadius: '24px',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />
        ) : (
          <div
            style={{
              width: '334px',
              height: '502px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '24px',
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: 'rgba(255,255,255,0.05)',
              fontSize: '120px',
            }}
          >
            🎬
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flex: 1,
            paddingLeft: '56px',
          }}
        >
          <div
            style={{
              fontSize: '24px',
              letterSpacing: '6px',
              textTransform: 'uppercase',
              color: '#f9a8d4',
              marginBottom: '24px',
            }}
          >
            Filmmoo recommends
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              fontSize: '64px',
              fontWeight: 700,
              lineHeight: 1.1,
              marginBottom: '28px',
            }}
          >
            <span>{title}</span>
            {yearSuffix ? <span style={{ color: 'rgba(255,255,255,0.4)' }}>{yearSuffix}</span> : null}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: '30px',
              lineHeight: 1.4,
              fontStyle: 'italic',
              color: 'rgba(251,207,232,0.9)',
            }}
          >
            {reason}
          </div>
        </div>
      </div>
    ),
    size
  );
}
