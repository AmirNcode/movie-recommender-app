'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { logger } from '@/lib/logger';
import type { AuthActionResult, SignupActionResult } from '@/types/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function login(formData: FormData): Promise<AuthActionResult> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { status: 'error', error: 'Email and password are required' };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { status: 'error', error: error.message };
  }

  revalidatePath('/', 'layout');
  return { status: 'success' };
}

export async function signup(formData: FormData): Promise<SignupActionResult> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim().slice(0, 100) || undefined;

  if (!email || !password) {
    return { status: 'error', error: 'Email and password are required' };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
      },
    },
  });

  if (error) {
    return { status: 'error', error: error.message };
  }

  revalidatePath('/', 'layout');

  if (data.session) {
    return { status: 'signed-in' };
  }

  return {
    status: 'email-confirmation-required',
    email,
  };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

/**
 * Permanently deletes the caller's account and all owned data.
 *
 * This is irreversible. The caller must pass the exact literal `DELETE`
 * (also enforced client-side). Deletion goes through the service-role admin
 * client's `auth.admin.deleteUser`; every user-owned table FK-cascades from
 * `auth.users`, so the row wipe is atomic at the DB level. The session is then
 * cleared and the user is redirected to `/signup`.
 */
export async function deleteAccount(confirmation: string): Promise<AuthActionResult> {
  if (confirmation !== 'DELETE') {
    return { status: 'error', error: 'Type DELETE to confirm account deletion.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { status: 'error', error: 'Unauthorized' };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'deleteAccount', user.id);
  if (!rateCheck.allowed) {
    return {
      status: 'error',
      error: `Too many attempts. Please try again in ${rateCheck.retryAfter} seconds.`,
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    logger.error('DELETE_ACCOUNT_NO_ADMIN_CLIENT');
    return { status: 'error', error: 'Account deletion is temporarily unavailable.' };
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    logger.error('DELETE_ACCOUNT_FAILED', { error: deleteError.message });
    return { status: 'error', error: 'Failed to delete your account. Please try again.' };
  }

  // Clear the now-orphaned session cookies; ignore any error (the user is gone).
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/signup');
}
