import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token';
import { logger } from '@/lib/logger';

// One-click weekly-digest unsubscribe (S9). Public — the HMAC token in the
// link is the only auth; it proves possession of the emailed link, not a
// session. Scope is narrow: it can only flip this one user's digest_opt_in.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function htmlResponse(message: string, status: number): NextResponse {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Filmmoo</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;font-family:sans-serif;"><p style="max-width:320px;text-align:center;font-size:15px;line-height:1.5;">${message}</p></body></html>`;
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get('uid');
  const token = request.nextUrl.searchParams.get('token');

  if (!uid || !token || !UUID_RE.test(uid)) {
    return htmlResponse('Invalid unsubscribe link.', 400);
  }

  let valid: boolean;
  try {
    valid = verifyUnsubscribeToken(uid, token);
  } catch (error) {
    logger.error('UNSUBSCRIBE_MISCONFIGURED', { error: String(error) });
    return htmlResponse('Unsubscribe is temporarily unavailable. Please try again later.', 500);
  }

  if (!valid) {
    return htmlResponse('Invalid or expired unsubscribe link.', 400);
  }

  const admin = createAdminClient();
  if (!admin) {
    logger.error('UNSUBSCRIBE_NO_ADMIN_CLIENT', {});
    return htmlResponse('Unsubscribe is temporarily unavailable. Please try again later.', 500);
  }

  const { error } = await admin.from('profiles').update({ digest_opt_in: false }).eq('id', uid);
  if (error) {
    logger.warn('UNSUBSCRIBE_UPDATE_FAILED', { error: error.message });
    return htmlResponse('Something went wrong. Please try again later.', 500);
  }

  return htmlResponse("You've been unsubscribed from the Filmmoo weekly digest.", 200);
}
