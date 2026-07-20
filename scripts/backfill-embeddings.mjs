/**
 * One-off/utility backfill: embed every pool movie that has no embedding yet.
 * The nightly cron (app/api/cron/refresh-pool) keeps new pool rows embedded;
 * this script clears a backlog (initial S11 ship, or after resetting vectors).
 *
 * Usage: node --env-file=.env scripts/backfill-embeddings.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM = 768;
const BATCH = 100;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
if (!url || !secretKey || !geminiKey) {
  console.error('Missing env: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY');
  process.exit(1);
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false } });
const ai = new GoogleGenAI({ apiKey: geminiKey });

function movieEmbeddingText(m) {
  const year = m.year ? ` (${m.year})` : '';
  const genre = m.genre ? ` — ${m.genre}.` : '';
  const synopsis = m.synopsis ? ` ${m.synopsis}` : '';
  return `${m.title}${year}${genre}${synopsis}`.slice(0, 2000);
}

function normalise(vec) {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  if (sumSq === 0) return null;
  const norm = Math.sqrt(sumSq);
  return vec.map((v) => v / norm);
}

let totalEmbedded = 0;
let totalFailed = 0;

for (;;) {
  const { data, error } = await supabase
    .from('movies_cache')
    .select('tmdb_movie_id, title, year, genre, synopsis')
    .not('pool_rank', 'is', null)
    .is('embedding', null)
    .limit(BATCH);

  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  // Free-tier Gemini allows 100 embed requests/min (each batch item counts);
  // retry on 429 and pace one batch per minute.
  let response = null;
  for (let attempt = 0; attempt < 5 && !response; attempt++) {
    try {
      response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: data.map(movieEmbeddingText),
        config: { outputDimensionality: EMBEDDING_DIM, taskType: 'RETRIEVAL_DOCUMENT' },
      });
    } catch (err) {
      if (err?.status === 429 && attempt < 4) {
        console.log('Rate limited; waiting 65s...');
        await new Promise((resolve) => setTimeout(resolve, 65_000));
      } else {
        throw err;
      }
    }
  }
  const embeddings = response?.embeddings ?? [];

  for (let i = 0; i < data.length; i++) {
    const values = embeddings[i]?.values;
    const vector = values && values.length === EMBEDDING_DIM ? normalise(values) : null;
    if (!vector) {
      totalFailed++;
      console.warn(`No embedding for tmdb ${data[i].tmdb_movie_id}`);
      continue;
    }
    const { error: updateError } = await supabase
      .from('movies_cache')
      .update({ embedding: `[${vector.join(',')}]` })
      .eq('tmdb_movie_id', data[i].tmdb_movie_id);
    if (updateError) {
      totalFailed++;
      console.warn(`Update failed for tmdb ${data[i].tmdb_movie_id}: ${updateError.message}`);
      continue;
    }
    totalEmbedded++;
  }
  console.log(`Progress: ${totalEmbedded} embedded, ${totalFailed} failed`);
  if (totalFailed > 0 && totalEmbedded === 0) {
    console.error('Nothing succeeding; aborting to avoid a loop.');
    process.exit(1);
  }
}

console.log(`Done. Embedded ${totalEmbedded} movies (${totalFailed} failures).`);
