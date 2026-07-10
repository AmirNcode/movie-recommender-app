import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { assertServerEnv } from '@/lib/env'

export function createAdminClient() {
  // Fail loudly on misconfiguration; makes the null-return below unreachable
  // at runtime (kept only as a type-level fallback).
  assertServerEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY

  if (!url || !secretKey) {
    return null
  }

  return createClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
