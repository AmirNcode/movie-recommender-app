import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Filmmoo',
  description: 'Filmmoo privacy policy template for owner review.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-16 text-white">
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-blue-300">Owner review required</p>
          <h1 className="font-serif text-4xl font-bold tracking-tight md:text-5xl">Privacy Policy</h1>
          <p className="text-sm leading-6 text-white/60">
            This is a plain-language template for Filmmoo and is not legal advice. The owner should review it with
            counsel and replace the contact placeholder before launch.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What Filmmoo Stores</h2>
          <p className="leading-7 text-white/70">
            Filmmoo stores account information such as your email address and optional display name. It also stores
            movie activity needed to run the product, including swipe history, watchlist entries, recommendation
            history, and related movie metadata.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How Filmmoo Uses Data</h2>
          <p className="leading-7 text-white/70">
            Filmmoo uses your movie activity to personalize recommendations, keep your watchlist available across
            sessions, protect the service from abuse, diagnose errors, and understand product usage at an aggregate
            level.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Processors</h2>
          <p className="leading-7 text-white/70">
            Filmmoo relies on Supabase for authentication and database storage, Vercel for hosting and analytics,
            Google Gemini for AI recommendations, TMDB for movie data, Sentry for error monitoring, and Stripe for
            billing if paid plans are enabled in the future.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Deletion Rights</h2>
          <p className="leading-7 text-white/70">
            You can request deletion of your Filmmoo account and associated personal data. Deletion requests should be
            sent from the email address connected to your account so the owner can verify the request.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="leading-7 text-white/70">
            Contact email placeholder: <span className="font-mono text-white">legal-contact@example.com</span>. Replace
            this with Filmmoo&apos;s production support or privacy email before launch.
          </p>
        </section>
      </article>
    </main>
  );
}
