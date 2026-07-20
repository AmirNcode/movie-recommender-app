/**
 * Movie/taste embeddings (S11).
 *
 * Pool movies are embedded once (nightly cron) with gemini-embedding-001 at
 * 768 dimensions; a user's taste vector is the weighted mean of their rated
 * movies' vectors. gemini-embedding-001 only returns normalised vectors at the
 * full 3072 dims, so every vector is L2-normalised here before storage or
 * querying — cosine distance in pgvector then behaves consistently.
 */
import { GoogleGenAI } from '@google/genai';
import { logger } from '@/lib/logger';

export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIM = 768;

/** Max texts per embedContent batch request. */
const EMBED_BATCH_SIZE = 100;

/** Action weights for the user taste vector (spec: S11 step 4). */
export const TASTE_WEIGHTS: Record<string, number> = {
  loved: 1.0,
  watched: 0.4,
  disliked: -0.7,
};

type EmbeddableMovie = {
  title: string;
  year: number | null;
  genre: string | null;
  synopsis: string | null;
};

/** Canonical text representation of a movie for embedding. */
export function movieEmbeddingText(movie: EmbeddableMovie): string {
  const year = movie.year ? ` (${movie.year})` : '';
  const genre = movie.genre ? ` — ${movie.genre}.` : '';
  const synopsis = movie.synopsis ? ` ${movie.synopsis}` : '';
  return `${movie.title}${year}${genre}${synopsis}`.slice(0, 2000);
}

/** L2-normalises a vector in place-safe fashion; returns null for zero vectors. */
export function normalise(vec: number[]): number[] | null {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  if (sumSq === 0) return null;
  const norm = Math.sqrt(sumSq);
  return vec.map((v) => v / norm);
}

/**
 * Weighted mean of embeddings, L2-normalised. Returns null when inputs are
 * empty or cancel out (e.g. only disliked movies mirroring loved ones).
 */
export function computeTasteVector(
  entries: Array<{ embedding: number[]; weight: number }>
): number[] | null {
  if (entries.length === 0) return null;
  const dim = entries[0].embedding.length;
  const acc = new Array<number>(dim).fill(0);
  for (const { embedding, weight } of entries) {
    if (embedding.length !== dim) continue;
    for (let i = 0; i < dim; i++) acc[i] += embedding[i] * weight;
  }
  return normalise(acc);
}

/** pgvector text literal for a vector (what PostgREST expects for vector columns). */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/** Parses a pgvector value returned by PostgREST (string literal) into numbers. */
export function fromVectorLiteral(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

/**
 * Embeds a batch of texts. Returns one normalised 768-dim vector per input
 * (null for entries the API failed to embed). Batches of 100 per request.
 *
 * @param taskType RETRIEVAL_DOCUMENT for corpus (pool movies); RETRIEVAL_QUERY
 *                 is not used — the taste vector is derived from stored
 *                 document vectors, keeping user vectors and movie vectors in
 *                 the same space.
 */
export async function embedTexts(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'SEMANTIC_SIMILARITY' = 'RETRIEVAL_DOCUMENT'
): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const results: Array<number[] | null> = [];

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    try {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: batch,
        config: { outputDimensionality: EMBEDDING_DIM, taskType },
      });
      const embeddings = response.embeddings ?? [];
      for (let i = 0; i < batch.length; i++) {
        const values = embeddings[i]?.values;
        results.push(values && values.length === EMBEDDING_DIM ? normalise(values) : null);
      }
    } catch (error) {
      logger.warn('EMBED_BATCH_FAILED', { batchStart: start, error: String(error) });
      for (let i = 0; i < batch.length; i++) results.push(null);
    }
  }

  return results;
}
