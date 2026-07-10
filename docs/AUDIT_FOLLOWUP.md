# Audit Follow-up — Remaining Items After F1–F20 Implementation

Review of the completed PRODUCTION_AUDIT.md work (verified 2026-07-10): all 20 findings are correctly implemented. Code verified against each finding's VERIFY step; live Supabase project `bhtkujcfvknxphatejbu` re-checked (security advisors clear except one dashboard toggle; profiles INSERT policy live; 6 users = 6 profiles; pg_cron purge job scheduled; all 12 migrations in the live ledger). Gates pass: `tsc --noEmit`, `eslint`, `next build`, `npm audit` (0 vulnerabilities). Runtime-verified on a production build: security headers present, unauthenticated `/` redirects to `/login`.

What remains is release logistics and dashboard configuration — no code defects.

## R1. Merge and push the audit work (all of it is stranded on a local branch)
- State: `main` is still at `a2cdf23` (pre-audit). All F1–F20 commits live only on local branch `fix/audit-d` (which contains a, b, c via merge). Nothing has been pushed to `origin`. A hardware failure right now loses the entire audit implementation.
- Fix:
  1. `git checkout main && git merge --no-ff fix/audit-d -m "Merge production audit fixes (F1-F20)"`
  2. `git push origin main`
  3. Delete merged local branches: `git branch -d fix/audit-a fix/audit-b fix/audit-c fix/audit-d`
- Verify: `git log origin/main -1` shows the merge commit; `git status` clean.

## R2. Commit the audit documents
- State: `docs/PRODUCTION_AUDIT.md`, `docs/IMPROVEMENTS.md`, and this file are untracked.
- Fix: `git add docs/ && git commit -m "docs: production audit, follow-up, and improvements roadmap"` then push. (Do this before/with R1.)
- Verify: `git ls-files docs/` lists all four docs.

## R3. End-to-end smoke on the merged main (belt-and-braces)
- The step-8 smoke was run inside session D on the branch; re-run once on merged `main` against a dev server: signup (new throwaway email) → onboarding-less deck loads ≥1 card → swipe 5 (mixed actions) → Recommend → reason references rated titles → add rec to watchlist → open watchlist, rate it → appears in history → profile: save name, verify persisted after reload → logout.
- Verify: no error banners except expected ones; `swipe_events` gained rows for the test user.

## R4. OPS checklist — dashboard items still outstanding (owner or agent-with-dashboard-access)
Confirmed still pending via live advisor: leaked-password protection is OFF. The full list from PRODUCTION_AUDIT.md OPS (none of these are code):
1. Vercel env vars (Production + Preview): `GEMINI_API_KEY`, `TMDB_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
2. Supabase Auth → URL Configuration: production Site URL + `https://<prod-domain>/auth/callback` redirect.
3. Google Cloud OAuth client: production origins + Supabase callback URL.
4. Supabase Auth: enable leaked-password protection; set min password length 8 (code now enforces 8 — F13); enable email confirmations; enable CAPTCHA (Turnstile).
5. Custom SMTP (Resend/Postmark) — built-in sender throttles at a few emails/hour.
6. TMDB attribution in app footer (lands with IMPROVEMENTS L1) + commercial license before monetization (D4).
7. Gemini billing budget alert.
8. Supabase backups/PITR verification.

## Non-issues (do not "fix")
- Performance advisors show only INFO "unused index" entries — the indexes are new; leave them.
- `supabase_migrations.schema_migrations` contains a benign duplicate `drop_orphaned_record_swipe_event` entry (see PRODUCTION_AUDIT.md F21).
- Three `eslint-disable react-hooks/set-state-in-effect` comments in `app/page.tsx` (commit 974bb67) are documented false-positive suppressions, not hidden bugs.
