'use client';

import { EyeOff, Eye, Heart, ThumbsDown } from 'lucide-react';
import type { SwipeAction } from '@/types/movie';

export function SwipeControls({ onAction }: { onAction: (action: SwipeAction) => void }) {
  return (
    <div className="flex items-center justify-center gap-4 mt-8 z-10">
      <button onClick={() => onAction('unwatched')} aria-label="Unwatched" className="w-14 h-14 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center hover:bg-blue-500/20 transition-colors border border-blue-500/30">
        <EyeOff size={24} />
      </button>
      <button onClick={() => onAction('disliked')} aria-label="Disliked" className="w-14 h-14 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center hover:bg-orange-500/20 transition-colors border border-orange-500/30">
        <ThumbsDown size={24} />
      </button>
      <button onClick={() => onAction('loved')} aria-label="Loved" className="w-14 h-14 rounded-full bg-pink-500/10 text-pink-500 flex items-center justify-center hover:bg-pink-500/20 transition-colors border border-pink-500/30">
        <Heart size={24} />
      </button>
      <button onClick={() => onAction('watched')} aria-label="Watched" className="w-14 h-14 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center hover:bg-green-500/20 transition-colors border border-green-500/30">
        <Eye size={24} />
      </button>
    </div>
  );
}
