import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function getSafeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return '/'
  }
  return next
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = getSafeNext(requestUrl.searchParams.get('next'))

  if (!code) {
    const errorUrl = new URL('/login', requestUrl.origin)
    errorUrl.searchParams.set('error', 'missing_code')
    if (next !== '/') errorUrl.searchParams.set('next', next)
    return NextResponse.redirect(errorUrl)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    const errorUrl = new URL('/login', requestUrl.origin)
    errorUrl.searchParams.set('error', 'oauth_callback_failed')
    if (next !== '/') errorUrl.searchParams.set('next', next)
    return NextResponse.redirect(errorUrl)
  }

  if (next === '/' || next === '/onboarding') {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const { count } = await supabase
        .from('swipe_states')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .limit(1)

      if (!count) {
        return NextResponse.redirect(new URL('/onboarding', requestUrl.origin))
      }
    }

    if (next === '/onboarding') {
      return NextResponse.redirect(new URL('/', requestUrl.origin))
    }
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin))
}
