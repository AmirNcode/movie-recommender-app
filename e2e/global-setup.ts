/**
 * Seeds throwaway Supabase auth users for the e2e specs and deletes them
 * afterward. The smoke spec uses one user; the Movie Night spec (S6) needs
 * three (host, guest, and a third account for the RLS-denial check). Requires
 * SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL (loaded from .env — Node reads
 * it directly since this runs outside Next.js's own env loading).
 */
import { createClient } from '@supabase/supabase-js';

const PASSWORD = 'e2e-smoke-test-password-1234';

function email(tag: string): string {
  return `filmmoo-e2e-${tag}-${Date.now()}@example.com`;
}

export default async function globalSetup() {
  process.loadEnvFile?.('.env');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      'E2E tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.'
    );
  }

  const admin = createClient(url, secretKey, { auth: { persistSession: false } });

  // tag → [emailEnvVar, passwordEnvVar]
  const accounts: Record<string, [string, string]> = {
    smoke: ['E2E_TEST_EMAIL', 'E2E_TEST_PASSWORD'],
    a: ['MN_A_EMAIL', 'MN_A_PASSWORD'],
    b: ['MN_B_EMAIL', 'MN_B_PASSWORD'],
    c: ['MN_C_EMAIL', 'MN_C_PASSWORD'],
  };

  const createdIds: string[] = [];

  for (const [tag, [emailVar, passwordVar]] of Object.entries(accounts)) {
    const addr = email(tag);
    const { data, error } = await admin.auth.admin.createUser({
      email: addr,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Failed to create e2e user "${tag}": ${error?.message}`);
    }
    process.env[emailVar] = addr;
    process.env[passwordVar] = PASSWORD;
    createdIds.push(data.user.id);
  }

  return async function globalTeardown() {
    for (const id of createdIds) {
      await admin.auth.admin.deleteUser(id);
    }
  };
}
