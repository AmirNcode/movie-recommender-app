'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, X } from 'lucide-react';

const PRO_FEATURES = [
  'Unlimited daily recommendations',
  'Unlimited Movie Nights with friends',
  'Full deck filters — decade range & minimum rating',
];

/**
 * S13: shown when `getMovieRecommendation` returns `quota_exceeded`.
 *
 * Stripe checkout (S14) isn't wired up yet, so the CTA opens a waitlist
 * mailto until billing ships — swap for `createCheckoutSession` then.
 */
export function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              <X size={16} />
            </button>

            <div className="flex items-center gap-2 text-amber-300">
              <Sparkles size={18} />
              <span className="text-xs uppercase tracking-widest font-semibold">Filmmoo Pro</span>
            </div>

            <div>
              <h2 className="text-lg font-semibold">Daily limit reached</h2>
              <p className="text-sm text-white/60 mt-1">
                You&apos;ve used today&apos;s free recommendations. Upgrade to Pro for unlimited picks.
              </p>
            </div>

            <ul className="space-y-2">
              {PRO_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-white/80">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-300 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <a
              href="mailto:hello@filmmoo.com?subject=Filmmoo%20Pro%20waitlist"
              className="block w-full py-3.5 rounded-2xl bg-white text-black font-bold tracking-wide text-center text-sm uppercase hover:bg-white/90 transition-colors"
            >
              Join the Pro waitlist
            </a>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-2xl bg-white/10 border border-white/10 text-white font-semibold text-sm hover:bg-white/15 transition-colors"
            >
              Not now
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
