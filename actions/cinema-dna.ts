/**
 * Cinema DNA server actions (S16): Pro-gated Gemini taste report, cached on
 * profiles for a week, shareable through the public /r/<id> mechanism (S2).
 */
'use server';

import { GoogleGenAI, Type } from '@google/genai';
import type { ActionResult } from '@/types/actions';
import type { Json } from '@/types/supabase';
import { capCinemaDna, isValidCinemaDna, type CinemaDna } from '@/lib/cinema-dna';
import { buildTasteProfile, tasteSectionsText } from '@/lib/taste-profile';
import { checkRateLimit } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { getClientIp } from '@/lib/request-ip';
import { isPro } from '@/lib/billing';
import { logger } from '@/lib/logger';
import { assertServerEnv } from '@/lib/env';

// Throws on first server-side import at runtime if required env is missing.
assertServerEnv();

/** Cached DNA stays authoritative for a week (spec: regenerate at most weekly). */
const DNA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CinemaDnaResult = { dna: CinemaDna; generatedAt: string };

function isFresh(generatedAt: string | null): boolean {
  if (!generatedAt) return false;
  const ts = new Date(generatedAt).getTime();
  return Number.isFinite(ts) && Date.now() - ts < DNA_TTL_MS;
}

/**
 * Returns the user's Cinema DNA, generating it when absent or — with
 * `regenerate` — when the weekly cache has lapsed. A fresh cached report is
 * always returned as-is, so regeneration cannot exceed once a week.
 */
export async function getCinemaDna(
  options?: { regenerate?: boolean }
): Promise<ActionResult<CinemaDnaResult>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  if (!(await isPro(user.id))) {
    return {
      ok: false,
      code: 'pro_required',
      message: 'Cinema DNA is a Pro feature — upgrade to generate yours.',
    };
  }

  try {
    const { data: profileRow, error: readError } = await supabase
      .from('profiles')
      .select('cinema_dna, dna_generated_at')
      .eq('id', user.id)
      .maybeSingle();

    if (readError) {
      logger.warn('CINEMA_DNA_READ_FAILED', { error: readError.message });
      return { ok: false, code: 'load_failed', message: 'Failed to load your Cinema DNA.' };
    }

    const cached = profileRow?.cinema_dna;
    const generatedAt = profileRow?.dna_generated_at ?? null;
    if (isValidCinemaDna(cached) && (isFresh(generatedAt) || !options?.regenerate)) {
      return { ok: true, data: { dna: capCinemaDna(cached), generatedAt: generatedAt ?? '' } };
    }

    const ip = await getClientIp();
    const rateCheck = await checkRateLimit(ip, 'getCinemaDna', user.id);
    if (!rateCheck.allowed) {
      return {
        ok: false,
        code: 'rate_limited',
        message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter,
      };
    }

    const profile = await buildTasteProfile(user.id);
    if (profile.loved.length + profile.watched.length + profile.disliked.length === 0) {
      return { ok: false, code: 'no_taste_profile', message: 'Rate at least one movie first.' };
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `
You are a film critic writing a playful, insightful "Cinema DNA" persona for a
user based on their movie taste profile below.

## User taste profile

${tasteSectionsText(profile)}

## Instructions

Write their Cinema DNA:
- "archetype": a short, evocative persona name (e.g. "The Midnight Auteur").
- "headline": ONE sentence capturing their taste, referencing a loved film by name.
- "traits": exactly 3 short trait phrases (max ~8 words each).
- "guilty_pleasure": the mainstream comfort pick their profile hints at.
- "blind_spot": a genre or era they haven't explored that fits them.

Be specific to THIS profile — never generic. Return ONLY valid JSON.
`.trim();

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            archetype: { type: Type.STRING },
            headline: { type: Type.STRING },
            traits: { type: Type.ARRAY, items: { type: Type.STRING } },
            guilty_pleasure: { type: Type.STRING },
            blind_spot: { type: Type.STRING },
          },
          required: ['archetype', 'headline', 'traits', 'guilty_pleasure', 'blind_spot'],
        },
      },
    });

    const parsed: unknown = response.text ? JSON.parse(response.text) : null;
    if (!isValidCinemaDna(parsed)) {
      logger.error('CINEMA_DNA_INVALID_SHAPE', {
        preview: String(JSON.stringify(parsed)).slice(0, 200),
      });
      // A stale-but-valid cache beats a failure.
      if (isValidCinemaDna(cached)) {
        return { ok: true, data: { dna: capCinemaDna(cached), generatedAt: generatedAt ?? '' } };
      }
      return { ok: false, code: 'load_failed', message: 'Could not generate your Cinema DNA. Please try again.' };
    }

    const dna = capCinemaDna(parsed);
    const now = new Date().toISOString();
    const { error: writeError } = await supabase
      .from('profiles')
      .update({ cinema_dna: dna as unknown as Json, dna_generated_at: now })
      .eq('id', user.id);
    if (writeError) {
      // Non-fatal: the user still gets the report; it just won't be cached.
      logger.warn('CINEMA_DNA_CACHE_WRITE_FAILED', { error: writeError.message });
    }

    return { ok: true, data: { dna, generatedAt: now } };
  } catch (error) {
    logger.error('CINEMA_DNA_FAILED', { error: String(error) });
    return { ok: false, code: 'load_failed', message: 'Could not generate your Cinema DNA. Please try again.' };
  }
}

/**
 * Publishes the user's cached Cinema DNA as a public /r/<id> card (kind='dna';
 * tmdb_movie_id 0, archetype as title, headline as reason, full payload in
 * `dna`). No author identity is exposed on the public page.
 */
export async function shareCinemaDna(): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in to continue.' };
  }

  if (!(await isPro(user.id))) {
    return {
      ok: false,
      code: 'pro_required',
      message: 'Cinema DNA is a Pro feature — upgrade to share yours.',
    };
  }

  const ip = await getClientIp();
  const rateCheck = await checkRateLimit(ip, 'shareCinemaDna', user.id);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    };
  }

  try {
    const { data: profileRow, error: readError } = await supabase
      .from('profiles')
      .select('cinema_dna')
      .eq('id', user.id)
      .maybeSingle();

    if (readError) {
      logger.warn('CINEMA_DNA_SHARE_READ_FAILED', { error: readError.message });
      return { ok: false, code: 'load_failed', message: 'Could not create a share link. Please try again.' };
    }

    if (!isValidCinemaDna(profileRow?.cinema_dna)) {
      return { ok: false, code: 'validation', message: 'Generate your Cinema DNA first.' };
    }
    const dna = capCinemaDna(profileRow.cinema_dna);

    const { data, error } = await supabase
      .from('shared_recommendations')
      .insert({
        user_id: user.id,
        tmdb_movie_id: 0,
        movie_title: dna.archetype,
        movie_year: null,
        poster_url: null,
        reason: dna.headline,
        kind: 'dna',
        dna: dna as unknown as Json,
      })
      .select('id')
      .single();

    if (error || !data) {
      logger.warn('CINEMA_DNA_SHARE_INSERT_FAILED', { error: error?.message });
      return { ok: false, code: 'save_failed', message: 'Could not create a share link. Please try again.' };
    }

    return { ok: true, data: { url: `/r/${data.id}` } };
  } catch (error) {
    logger.error('CINEMA_DNA_SHARE_FAILED', { error: String(error) });
    return { ok: false, code: 'save_failed', message: 'Could not create a share link. Please try again.' };
  }
}
