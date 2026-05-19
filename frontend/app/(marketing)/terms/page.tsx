import Link from 'next/link'
import EyebrowLabel from '@/components/brand/EyebrowLabel'

export const dynamic = 'force-static'
export const metadata = { title: 'Terms — The FOUND3RY' }

const LAST_UPDATED = 'May 19, 2026'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-off-white font-archivo">
      <header className="border-b border-n200 px-6 py-4">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <Link href="/" className="font-archivo-black text-lg text-ink no-underline">
            FOUND<span className="text-arc-cyan-deep">3</span>RY
          </Link>
          <div className="flex gap-6 text-xs font-mono uppercase tracking-wider text-n600">
            <Link href="/" className="hover:text-ink">Home</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <EyebrowLabel number="01" keyword={`Last updated · ${LAST_UPDATED}`} />
        <h1 className="font-archivo-black text-5xl text-ink leading-none mt-3 mb-8">
          Terms.
        </h1>

        <Section title="1. The deal">
          <p>
            These Terms govern your use of FOUND3RY (the "Service"), operated by h3ros. By creating
            an account or using the Service you agree to these Terms and our{' '}
            <Link href="/privacy" className="text-arc-cyan-deep">Privacy Policy</Link>. If you don't agree, don't use the Service.
          </p>
        </Section>

        <Section title="2. Your account">
          <ul className="list-disc pl-6 space-y-2">
            <li>You must be 13 or older to create an account.</li>
            <li>You are responsible for keeping your password and any API credentials secure.</li>
            <li>One person per account. You can share workspace access with collaborators via invites.</li>
            <li>
              You can delete your account at any time from{' '}
              <Link href="/settings" className="text-arc-cyan-deep">Settings</Link>.
            </li>
          </ul>
        </Section>

        <Section title="3. Your content stays yours">
          <p>
            You own everything you create or upload to FOUND3RY. By using the Service you grant us a
            limited license to store, process, and display your content as needed to provide the
            Service to you (and to your invited collaborators). That license ends when you delete
            the content or your account.
          </p>
        </Section>

        <Section title="4. Connectors">
          <p>
            When you authorize a connector (GitHub, Linear, Notion, etc.), you grant FOUND3RY
            permission to read the data scopes the connector requested. We do not modify, delete, or
            write back to those tools unless you explicitly enable an action that does so. You can
            disconnect a connector at any time from{' '}
            <Link href="/settings/connections" className="text-arc-cyan-deep">Connections</Link>.
          </p>
        </Section>

        <Section title="5. Acceptable use">
          <p className="mb-3">Don't use FOUND3RY to:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Break the law or violate anyone's rights.</li>
            <li>Reverse-engineer, scrape, or attempt to extract source code from the Service.</li>
            <li>Send spam, malware, or operate a credential-stuffing harness.</li>
            <li>Interfere with other accounts or with FOUND3RY infrastructure.</li>
            <li>Train models on other users' workspace data.</li>
          </ul>
          <p className="mt-3">
            We can suspend or terminate accounts that violate this section. Egregious violations
            (CSAM, credible threats) get reported to authorities.
          </p>
        </Section>

        <Section title="6. AI outputs">
          <p>
            COFOUND3R generates answers using Anthropic's Claude. Outputs are probabilistic, can be
            wrong, and may include inaccurate references to your ventures. Treat them as drafts
            and verify before acting on them. You're responsible for what you do with the output.
          </p>
        </Section>

        <Section title="7. Payments">
          <p>
            Some features require a paid subscription. Pricing and inclusions are listed at{' '}
            <Link href="/pricing" className="text-arc-cyan-deep">/pricing</Link>. Payment is processed by Stripe;
            we never see or store your card. Subscriptions auto-renew unless cancelled before the
            renewal date. Cancellations take effect at the end of the current billing period; we
            don't pro-rate.
          </p>
        </Section>

        <Section title="8. Free / beta tier">
          <p>
            During early access we may offer free or discounted tiers. Those tiers may have lower
            quotas, no SLA, and we may change or remove them with reasonable notice.
          </p>
        </Section>

        <Section title="9. Service availability">
          <p>
            We work to keep the Service running, but we don't promise zero downtime. Maintenance,
            third-party outages (Railway, Vercel, Anthropic, etc.), and rare incidents will happen.
            See <Link href="/privacy" className="text-arc-cyan-deep">Privacy</Link> for our breach-notification commitment.
          </p>
        </Section>

        <Section title="10. Termination">
          <p>
            You can terminate your account anytime from Settings. We can terminate or suspend an
            account for violation of these Terms or for non-payment. On termination we'll
            permanently delete your workspace data within 30 days (except where retention is legally
            required, e.g. financial records).
          </p>
        </Section>

        <Section title="11. Warranty disclaimer">
          <p className="uppercase text-sm text-n600">
            The Service is provided "as is" and "as available" without warranties of any kind,
            express or implied, including merchantability, fitness for a particular purpose, and
            non-infringement, to the maximum extent permitted by law.
          </p>
        </Section>

        <Section title="12. Limitation of liability">
          <p className="uppercase text-sm text-n600">
            To the maximum extent permitted by law, h3ros's total liability for any claim arising
            out of or relating to these Terms or the Service is limited to the amount you paid us in
            the 12 months before the event giving rise to the claim. We are not liable for
            indirect, incidental, special, or consequential damages, or lost profits or data.
          </p>
        </Section>

        <Section title="13. Governing law">
          <p>
            These Terms are governed by the laws of the State of Delaware, USA, without regard to
            conflict-of-laws principles. Disputes go to the state and federal courts located in
            Delaware, and you consent to that jurisdiction.
          </p>
        </Section>

        <Section title="14. Changes">
          <p>
            When we change these Terms we'll update the "Last updated" date at the top and, for any
            material change, email all account holders. Continued use after a change means you
            accept the new Terms.
          </p>
        </Section>

        <Section title="15. Contact">
          <p>
            Legal questions:{' '}
            <a className="text-arc-cyan-deep" href="mailto:legal@found3ry.com">legal@found3ry.com</a>.
            Everything else: <a className="text-arc-cyan-deep" href="mailto:hello@found3ry.com">hello@found3ry.com</a>.
          </p>
        </Section>

        <footer className="mt-16 pt-8 border-t border-n200 text-xs font-mono text-n600">
          FOUND3RY is a venture of h3ros · <Link href="/privacy" className="hover:text-ink">Privacy</Link>
        </footer>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-archivo-black text-xl text-ink mb-3 uppercase tracking-tight">{title}</h2>
      <div className="text-base text-n700 leading-relaxed space-y-3">{children}</div>
    </section>
  )
}
