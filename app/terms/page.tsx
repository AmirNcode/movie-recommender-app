import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use | Filmmoo',
  description: 'Filmmoo terms of use template for owner review.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-16 text-white">
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-blue-300">Owner review required</p>
          <h1 className="font-serif text-4xl font-bold tracking-tight md:text-5xl">Terms of Use</h1>
          <p className="text-sm leading-6 text-white/60">
            This is a plain-language template for Filmmoo and is not legal advice. The owner should review it with
            counsel and replace the contact placeholder before launch.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Using Filmmoo</h2>
          <p className="leading-7 text-white/70">
            Filmmoo helps you discover movies, save watchlist items, and generate recommendations from your swipe
            history. You are responsible for keeping your account credentials secure and for using the service only in
            lawful ways.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Recommendations and Movie Data</h2>
          <p className="leading-7 text-white/70">
            Recommendations are generated from your activity and third-party movie data. They may be incomplete or
            inaccurate. Filmmoo does not guarantee that a movie, provider, price, or streaming availability is current
            or available in your region.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Third-Party Services</h2>
          <p className="leading-7 text-white/70">
            Filmmoo uses Supabase, Vercel, Google Gemini, TMDB, Sentry, and, if paid plans are enabled in the future,
            Stripe. Those services may process data as described in the privacy policy and may have their own terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Account Deletion</h2>
          <p className="leading-7 text-white/70">
            You may request account deletion and removal of associated personal data. The owner may need to verify the
            request before deleting the account.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="leading-7 text-white/70">
            Contact email placeholder: <span className="font-mono text-white">legal-contact@example.com</span>. Replace
            this with Filmmoo&apos;s production support or legal email before launch.
          </p>
        </section>
      </article>
    </main>
  );
}
