import { headers } from 'next/headers';

export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  const forwarded = headersList.get('x-vercel-forwarded-for') ?? headersList.get('x-forwarded-for');
  if (!forwarded) return '127.0.0.1';
  return forwarded.split(',')[0]?.trim() || '127.0.0.1';
}
