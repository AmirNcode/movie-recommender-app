'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { createCheckoutSession } from '@/actions/billing';
import type { BillingPlan } from '@/lib/stripe';

const PRO_FEATURES = [
  'Unlimited daily recommendations',
  'Unlimited Movie Nights with friends',
  'Full deck filters — decade range & minimum rating',
];

// D2 default price points; the authoritative amounts live on the Stripe prices.
const PLANS: { plan: BillingPlan; label: string; price: string }[] = [
  { plan: 'monthly', label: 'Monthly', price: '$2.50/mo' },
  { plan: 'yearly', label: 'Yearly', price: '$25/yr' },
];

/**
 * S13/S14: shown when a free user hits the daily recommendation quota.
 *
 * The CTA starts Stripe Checkout via {@link createCheckoutSession}. While
 * billing is disabled (D4 — `BILLING_ENABLED` off) the action returns a
 * `validation` failure; we surface it and fall back to the Pro waitlist so the
 * modal degrades gracefully before go-live.
 */
export function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pendingPlan, setPendingPlan] = useState<BillingPlan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const startCheckout = async (plan: BillingPlan) => {
    setNotice(null);
    setPendingPlan(plan);
    try {
      const result = await createCheckoutSession(plan);
      if (result.ok) {
        window.location.assign(result.data.url);
        return;
      }
      setNotice(result.message);
    } catch {
      setNotice('Something went wrong starting checkout. Please try again.');
    } finally {
      setPendingPlan(null);
    }
  };

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

            {notice ? (
              <p className="text-xs text-amber-200/90 bg-amber-400/10 border border-amber-400/20 rounded-xl p-3">
                {notice}
              </p>
            ) : null}

            <div className="flex gap-2">
              {PLANS.map(({ plan, label, price }) => (
                <button
                  key={plan}
                  onClick={() => void startCheckout(plan)}
                  disabled={pendingPlan !== null}
                  className="flex-1 flex flex-col items-center gap-0.5 py-3 rounded-2xl bg-white text-black font-bold disabled:opacity-60 hover:bg-white/90 transition-colors"
                >
                  {pendingPlan === plan ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      <span className="text-sm">{label}</span>
                      <span className="text-xs font-semibold text-black/60">{price}</span>
                    </>
                  )}
                </button>
              ))}
            </div>

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
