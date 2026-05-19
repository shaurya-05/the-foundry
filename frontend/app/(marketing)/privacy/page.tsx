import Link from 'next/link'
import EyebrowLabel from '@/components/brand/EyebrowLabel'

export const dynamic = 'force-static'
export const metadata = { title: 'Privacy — The FOUND3RY' }

const LAST_UPDATED = 'May 19, 2026'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-off-white font-archivo">
      <header className="border-b border-n200 px-6 py-4">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <Link href="/" className="font-archivo-black text-lg text-ink no-underline">
            FOUND<span className="text-arc-cyan-deep">3</span>RY
          </Link>
          <div className="flex gap-6 text-xs font-mono uppercase tracking-wider text-n600">
            <Link href="/" className="hover:text-ink">Home</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <EyebrowLabel number="01" keyword={`Last updated · ${LAST_UPDATED}`} />
        <h1 className="font-archivo-black text-5xl text-ink leading-none mt-3 mb-8">
          Privacy.
        </h1>

        <Section title="The short version">
          <p>
            FOUND3RY is a workspace operating system for multi-venture operators. To do its job it
            ingests data <em>you authorize</em> from tools you already use (GitHub today; Linear and
            Notion next). We store that data on infrastructure we control, encrypt access tokens at
            rest, and never sell or share it. You can disconnect a tool, export your data, or delete
            your account at any time.
          </p>
        </Section>

        <Section title="What we collect">
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Account info</strong> — your email, display name, and a hashed password
              (bcrypt). We never store your password in plaintext.
            </li>
            <li>
              <strong>Workspace contents</strong> — projects, ideas, tasks, knowledge items, and
              any text you create inside FOUND3RY.
            </li>
            <li>
              <strong>Connector data</strong> — when you authorize a connector (GitHub, etc.), we
              ingest the entities you grant access to: repos, commits, pull requests, issues,
              comments. We do <em>not</em> write back to the connector unless you explicitly opt in.
            </li>
            <li>
              <strong>OAuth access tokens</strong> — encrypted at rest with a per-deployment
              symmetric key (Fernet, AES-128-CBC + HMAC). Revoking a connection deletes the token.
            </li>
            <li>
              <strong>Operational logs</strong> — request paths, HTTP status, IP address, and
              duration for debugging and abuse prevention. We do not log secrets, tokens, or
              passwords.
            </li>
            <li>
              <strong>Embeddings</strong> — short text excerpts from your docs are sent to Voyage AI
              to produce vector embeddings. Voyage is contractually prohibited from using your
              content to train their models.
            </li>
            <li>
              <strong>Agent queries</strong> — when you ask COFOUND3R a question, the question plus
              the retrieval context is sent to Anthropic (Claude) to produce the answer. Anthropic
              does not train on API-tier inputs by default.
            </li>
          </ul>
        </Section>

        <Section title="What we do NOT collect">
          <ul className="list-disc pl-6 space-y-2">
            <li>Banking, credit-card, or government-ID numbers (Stripe handles payments).</li>
            <li>Browsing history outside the FOUND3RY app.</li>
            <li>Facial images, biometric data, or location.</li>
            <li>Third-party cookies or cross-site tracking pixels.</li>
          </ul>
        </Section>

        <Section title="Where your data lives">
          <p>
            Production data sits in a Postgres database operated on Railway (US region) with daily
            encrypted backups. Embeddings are stored in the same database (pgvector). OAuth tokens
            are encrypted with a Fernet key held only in our Railway environment. WebSocket and
            HTTP traffic is TLS-only via a Let's Encrypt certificate on{' '}
            <code>api.found3ry.com</code>.
          </p>
        </Section>

        <Section title="Who we share data with">
          <p className="mb-3">
            We share data only with subprocessors strictly necessary to run the service:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Railway</strong> — application hosting and Postgres.</li>
            <li><strong>Vercel</strong> — frontend hosting.</li>
            <li><strong>Anthropic</strong> — LLM responses for COFOUND3R.</li>
            <li><strong>Voyage AI</strong> — text embeddings.</li>
            <li><strong>Stripe</strong> — payment processing (when you subscribe).</li>
            <li><strong>Sentry</strong> — error monitoring (we scrub tokens before sending).</li>
            <li><strong>GitHub / Linear / Notion</strong> — only when you authorize a connector.</li>
          </ul>
          <p className="mt-3">We do not sell data. We do not run ad networks.</p>
        </Section>

        <Section title="Your rights">
          <p className="mb-3">
            If you're in the EU, UK, or California you have specific data rights (access,
            rectification, erasure, portability, objection). Regardless of jurisdiction, FOUND3RY
            gives every user the same controls:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Export</strong> — request a copy of your workspace data by emailing{' '}
              <a className="text-arc-cyan-deep" href="mailto:privacy@found3ry.com">privacy@found3ry.com</a>.
            </li>
            <li>
              <strong>Delete</strong> — from <Link className="text-arc-cyan-deep" href="/settings">Settings</Link>,
              the "Delete account" action permanently wipes your workspace, disconnects all OAuth
              connections, and purges your data within 30 days.
            </li>
            <li>
              <strong>Disconnect a connector</strong> — from{' '}
              <Link className="text-arc-cyan-deep" href="/settings/connections">Connections</Link>, click
              Disconnect. The access token is revoked and removed from our database.
            </li>
          </ul>
        </Section>

        <Section title="Children">
          <p>
            FOUND3RY is not directed at anyone under 13 and we do not knowingly collect data from
            children. If you believe a child has registered an account, email{' '}
            <a className="text-arc-cyan-deep" href="mailto:privacy@found3ry.com">privacy@found3ry.com</a>{' '}
            and we will delete it.
          </p>
        </Section>

        <Section title="Security incidents">
          <p>
            If we detect a breach affecting your data we will notify the affected accounts within 72
            hours of confirmation and disclose the scope, what we know, and what we're doing about
            it.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            When we change this policy we'll update the "Last updated" date at the top and, for any
            material change, email all account holders before the change takes effect.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Privacy questions, data requests, or anything that smells wrong:{' '}
            <a className="text-arc-cyan-deep" href="mailto:privacy@found3ry.com">privacy@found3ry.com</a>.
          </p>
        </Section>

        <footer className="mt-16 pt-8 border-t border-n200 text-xs font-mono text-n600">
          FOUND3RY is a venture of h3ros · <Link href="/terms" className="hover:text-ink">Terms</Link>
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
