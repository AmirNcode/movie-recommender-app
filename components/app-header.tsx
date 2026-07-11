'use client';

import Link from 'next/link';
import { History, Sparkles, UserRound, Bookmark, SlidersHorizontal, Users } from 'lucide-react';

type View = 'swipe' | 'recommendation' | 'watchlist' | 'history' | 'profile' | 'filters';

export function AppHeader({
  activeView,
  onChangeView,
  onRecommend,
  isRecommending,
  canRecommend,
}: {
  activeView: View;
  onChangeView: (view: View) => void;
  onRecommend: () => void;
  isRecommending: boolean;
  canRecommend: boolean;
}) {
  const baseClass = 'flex items-center justify-center w-12 h-12 rounded-full transition-colors border';
  const variant = (isActive: boolean) =>
    isActive
      ? `${baseClass} bg-white text-black border-white`
      : `${baseClass} bg-white/5 text-white border-white/10 hover:bg-white/10`;

  return (
    <header className="p-6 pb-5 flex items-start justify-between z-10 gap-4">
      <button onClick={() => onChangeView('swipe')} className="text-2xl font-serif font-bold tracking-tight text-left h-12 flex items-center">
        Filmmoo
      </button>
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center justify-end gap-2 flex-wrap h-12">
          <Link href="/night" className={variant(false)} aria-label="Movie Night">
            <Users size={18} />
          </Link>
          <button onClick={() => onChangeView('filters')} className={variant(activeView === 'filters')} aria-label="Deck filters">
            <SlidersHorizontal size={18} />
          </button>
          <button onClick={() => onChangeView('profile')} className={variant(activeView === 'profile')} aria-label="Profile">
            <UserRound size={18} />
          </button>
          <button onClick={() => onChangeView('watchlist')} className={variant(activeView === 'watchlist')} aria-label="Watchlist">
            <Bookmark size={18} />
          </button>
          <button onClick={() => onChangeView('history')} className={variant(activeView === 'history')} aria-label="History">
            <History size={18} />
          </button>
        </div>
        <button
          onClick={onRecommend}
          disabled={!canRecommend || isRecommending}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium border border-white/10"
        >
          <Sparkles size={16} />
          <span>Recommend</span>
        </button>
      </div>
    </header>
  );
}
