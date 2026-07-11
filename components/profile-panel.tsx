'use client';

import { useState, useTransition } from 'react';
import { updateDigestOptIn, updateEmail, updatePassword, updateProfileName } from '@/actions/library';
import { deleteAccount, logout } from '@/actions/auth';
import type { ProfileDetails } from '@/types/library';

export function ProfilePanel({ profile }: { profile: ProfileDetails | null }) {
  const [name, setName] = useState(profile?.name ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [password, setPassword] = useState('');
  const [digestOptIn, setDigestOptIn] = useState(profile?.digestOptIn ?? false);
  const [isDigestPending, setIsDigestPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDigestToggle = async () => {
    const next = !digestOptIn;
    setDigestOptIn(next);
    setIsDigestPending(true);
    setMessage(null);
    setError(null);
    const result = await updateDigestOptIn(next);
    setIsDigestPending(false);
    if (result.status === 'error') {
      setDigestOptIn(!next);
      setError(result.error);
      return;
    }
    setMessage(next ? 'Weekly digest enabled.' : 'Weekly digest disabled.');
  };

  const handleDelete = () => {
    setMessage(null);
    setError(null);
    startDeleteTransition(async () => {
      // On success the action clears the session and redirects to /signup, so
      // control only returns here on failure.
      const result = await deleteAccount(deleteConfirmText);
      if (result.status === 'error') setError(result.error);
    });
  };

  const runAction = (fn: () => Promise<{ status: 'success'; message?: string } | { status: 'error'; error: string }>) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? 'Saved.');
      setPassword('');
    });
  };

  return (
    <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Profile</h2>
        <p className="text-xs text-white/50 mt-1">Manage your Filmmoo account and sign-in details.</p>
      </div>

      {message ? <div className="p-3 text-sm text-green-300 bg-green-400/10 border border-green-400/20 rounded-xl">{message}</div> : null}
      {error ? <div className="p-3 text-sm text-red-300 bg-red-400/10 border border-red-400/20 rounded-xl">{error}</div> : null}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          runAction(async () => {
            const formData = new FormData();
            formData.set('name', name);
            return updateProfileName(formData);
          });
        }}
      >
        <div className="text-xs uppercase tracking-widest text-white/40">Display name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-12 bg-black/40 border border-white/10 rounded-2xl px-4 text-white" placeholder="Your name" />
        <button disabled={isPending} className="w-full h-11 rounded-2xl bg-white text-black font-semibold disabled:opacity-60">Save name</button>
      </form>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          runAction(async () => {
            const formData = new FormData();
            formData.set('email', email);
            return updateEmail(formData);
          });
        }}
      >
        <div className="text-xs uppercase tracking-widest text-white/40">Email</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full h-12 bg-black/40 border border-white/10 rounded-2xl px-4 text-white" placeholder="you@example.com" />
        <button disabled={isPending} className="w-full h-11 rounded-2xl bg-white/10 border border-white/10 text-white font-semibold disabled:opacity-60">Update email</button>
      </form>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          runAction(async () => {
            const formData = new FormData();
            formData.set('password', password);
            return updatePassword(formData);
          });
        }}
      >
        <div className="text-xs uppercase tracking-widest text-white/40">Password</div>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="w-full h-12 bg-black/40 border border-white/10 rounded-2xl px-4 text-white" placeholder="New password" minLength={8} />
        <button disabled={isPending || password.length < 8} className="w-full h-11 rounded-2xl bg-white/10 border border-white/10 text-white font-semibold disabled:opacity-60">Update password</button>
      </form>

      <div className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-white/10 bg-black/20">
        <div>
          <div className="text-sm font-semibold text-white">Weekly digest email</div>
          <p className="text-xs text-white/50 mt-0.5">Your top 3 unseen picks, every Monday.</p>
        </div>
        <button
          onClick={() => void handleDigestToggle()}
          disabled={isDigestPending}
          role="switch"
          aria-checked={digestOptIn}
          aria-label="Toggle weekly digest email"
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${digestOptIn ? 'bg-white' : 'bg-white/15'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${digestOptIn ? 'translate-x-5 bg-black' : 'translate-x-0 bg-white/70'}`}
          />
        </button>
      </div>

      <form action={logout}>
        <button className="w-full h-11 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-200 font-semibold">Log out</button>
      </form>

      <div className="pt-4 border-t border-red-500/20 space-y-3">
        <div className="text-xs uppercase tracking-widest text-red-400/70">Danger zone</div>
        {!confirmingDelete ? (
          <button
            onClick={() => {
              setConfirmingDelete(true);
              setMessage(null);
              setError(null);
            }}
            className="w-full h-11 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-200 font-semibold"
          >
            Delete account
          </button>
        ) : (
          <div className="space-y-3 p-4 rounded-2xl border border-red-500/30 bg-red-500/[0.06]">
            <p className="text-xs leading-relaxed text-red-200/80">
              This permanently deletes your account and all of your data — swipes, watchlist, and history. This
              cannot be undone. Type <span className="font-mono font-bold text-red-100">DELETE</span> to confirm.
            </p>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm account deletion"
              autoComplete="off"
              className="w-full h-12 bg-black/40 border border-red-500/30 rounded-2xl px-4 text-white font-mono"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteConfirmText('');
                }}
                disabled={isDeleting}
                className="flex-1 h-11 rounded-2xl bg-white/10 border border-white/10 text-white font-semibold disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting || deleteConfirmText !== 'DELETE'}
                className="flex-1 h-11 rounded-2xl bg-red-500 text-white font-semibold disabled:opacity-40"
              >
                {isDeleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
