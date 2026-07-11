'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { setPreferences } from '@/actions/preferences';
import { TMDB_GENRES } from '@/lib/tmdb-genres';
import type { UserPreferences } from '@/types/preferences';

export function FilterPanel({
  preferences,
  onSaved,
}: {
  preferences: UserPreferences | null;
  onSaved: (genres: number[]) => void;
}) {
  const [selected, setSelected] = useState<number[]>(preferences?.genres ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleGenre(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  async function save(genres: number[]) {
    setIsSaving(true);
    setMessage(null);
    setError(null);
    try {
      const result = await setPreferences(genres);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSelected(result.data.genres);
      setMessage(genres.length > 0 ? 'Filters saved — your deck is rebuilding.' : 'Filters cleared — your deck is rebuilding.');
      onSaved(result.data.genres);
    } catch {
      setError('Failed to save your filters. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Deck filters</h2>
        <p className="text-xs text-white/50 mt-1">Only see movies in the genres you pick. Leave empty for a mixed deck.</p>
      </div>

      {message ? <div className="p-3 text-sm text-green-300 bg-green-400/10 border border-green-400/20 rounded-xl">{message}</div> : null}
      {error ? <div className="p-3 text-sm text-red-300 bg-red-400/10 border border-red-400/20 rounded-xl">{error}</div> : null}

      <div>
        <div className="text-xs uppercase tracking-widest text-white/40 mb-3">Genres</div>
        <div className="flex flex-wrap gap-2">
          {TMDB_GENRES.map((genre) => {
            const isSelected = selected.includes(genre.id);
            return (
              <button
                key={genre.id}
                type="button"
                onClick={() => toggleGenre(genre.id)}
                className={
                  isSelected
                    ? 'px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-black border border-white'
                    : 'px-3 py-1.5 rounded-full text-xs font-semibold bg-black/30 text-white/70 border border-white/15 hover:bg-white/10'
                }
              >
                {genre.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 opacity-50">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40">
          <Lock size={12} />
          Decade range — Pro
        </div>
        <div className="h-11 rounded-2xl border border-white/10 bg-black/20" />

        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40 pt-1">
          <Lock size={12} />
          Minimum rating — Pro
        </div>
        <div className="h-11 rounded-2xl border border-white/10 bg-black/20" />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => void save([])}
          disabled={isSaving}
          className="flex-1 h-11 rounded-2xl bg-white/10 border border-white/10 text-white font-semibold disabled:opacity-60"
        >
          Clear
        </button>
        <button
          onClick={() => void save(selected)}
          disabled={isSaving}
          className="flex-1 h-11 rounded-2xl bg-white text-black font-semibold disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : 'Save filters'}
        </button>
      </div>
    </div>
  );
}
