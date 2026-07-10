'use server';

import { createClient } from '@/lib/supabase/server';
import type { AuthActionResult, SignupActionResult } from '@/types/auth';
import { revalidatePath } from 'next/cache';

export async function login(formData: FormData): Promise<AuthActionResult> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

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
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
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
}
