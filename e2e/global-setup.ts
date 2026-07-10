/**
 * Creates a throwaway Supabase auth user for the smoke spec and deletes it
 * afterward. Requires SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL to be
 * set (loaded from .env — Node reads it directly since this runs outside
 * Next.js's own env loading).
 */
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = `filmmoo-e2e-${Date.now()}@example.com`;
const TEST_PASSWORD = 'e2e-smoke-test-password-1234';

export default async function globalSetup() {
  process.loadEnvFile?.('.env');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      'E2E smoke test requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.'
    );
  }

  const admin = createClient(url, secretKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create e2e test user: ${error?.message}`);
  }

  process.env.E2E_TEST_EMAIL = TEST_EMAIL;
  process.env.E2E_TEST_PASSWORD = TEST_PASSWORD;
  const userId = data.user.id;

  return async function globalTeardown() {
    await admin.auth.admin.deleteUser(userId);
  };
}
