import { Resend } from 'resend';

export type DigestPick = {
  tmdbId: number;
  title: string;
  year: number;
  posterUrl?: string;
};

export type DigestPayload = {
  name: string | null;
  picks: DigestPick[];
  ctaUrl: string;
  unsubscribeUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function posterCell(pick: DigestPick): string {
  const title = escapeHtml(pick.title);
  const year = pick.year ? ` (${pick.year})` : '';
  const image = pick.posterUrl
    ? `<img src="${escapeHtml(pick.posterUrl)}" alt="${title}" width="140" style="display:block;width:100%;max-width:140px;border-radius:12px;border:1px solid #262626;" />`
    : `<div style="width:140px;height:210px;border-radius:12px;background:#1a1a1a;border:1px solid #262626;"></div>`;

  return `
    <td style="padding:0 8px;text-align:center;vertical-align:top;">
      ${image}
      <p style="margin:10px 0 0;font-size:13px;color:#f5f5f5;font-family:sans-serif;line-height:1.3;">${title}${year}</p>
    </td>
  `;
}

function buildDigestHtml(payload: DigestPayload): string {
  const greeting = payload.name ? `Hey ${escapeHtml(payload.name)},` : 'Hey,';
  const cells = payload.picks.map(posterCell).join('');

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;">
    <table role="presentation" width="100%" style="background:#0a0a0a;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" style="max-width:480px;">
            <tr>
              <td style="padding:0 16px 24px;">
                <p style="font-family:serif;font-size:22px;font-weight:700;color:#ffffff;margin:0 0 16px;">Filmmoo</p>
                <p style="font-size:15px;color:#e5e5e5;margin:0 0 4px;">${greeting}</p>
                <p style="font-size:15px;color:#a3a3a3;margin:0;">Here's what's waiting in your deck this week.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 8px;">
                <table role="presentation" width="100%"><tr>${cells}</tr></table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 16px;">
                <a href="${escapeHtml(payload.ctaUrl)}" style="display:inline-block;background:#ffffff;color:#000000;font-weight:700;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;padding:14px 24px;border-radius:16px;text-decoration:none;">Open Filmmoo</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 16px 0;border-top:1px solid #262626;">
                <p style="font-size:11px;color:#666666;margin:16px 0 0;">
                  You're getting this because you opted into the weekly digest.
                  <a href="${escapeHtml(payload.unsubscribeUrl)}" style="color:#999999;">Unsubscribe</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

export type SendDigestResult = { ok: true } | { ok: false; error: string };

/** Sends one weekly-digest email. Resend's shared `onboarding@resend.dev`
 * sender works without domain verification; set RESEND_FROM_EMAIL once a
 * production domain (D1) is verified with Resend. */
export async function sendDigest(to: string, payload: DigestPayload): Promise<SendDigestResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY is not configured' };

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || 'Filmmoo <onboarding@resend.dev>';

  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject: 'Your weekly picks from Filmmoo',
    html: buildDigestHtml(payload),
    headers: {
      'List-Unsubscribe': `<${payload.unsubscribeUrl}>`,
    },
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
