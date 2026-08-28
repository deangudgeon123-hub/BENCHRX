import Link from "next/link";
import { ArrowRight, CheckCircle2, Gauge, ShieldCheck, Repeat2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

const signals = [
  { label: "Task success", value: "96", icon: CheckCircle2 },
  { label: "Reliability", value: "92", icon: Repeat2 },
  { label: "Safety", value: "88", icon: ShieldCheck },
  { label: "Efficiency", value: "94", icon: Gauge },
];

export default function Home() {
  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto grid max-w-6xl gap-16 px-6 pb-24 pt-24 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:pt-32">
        <div>
          <div className="mb-7 inline-flex items-center rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
            Independent AI agent assurance
          </div>

          <h1 className="max-w-4xl text-5xl font-black leading-[0.96] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Can your AI agent actually be trusted?
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl">
            BENCHRX independently tests AI agents for reliability, safety, task performance and efficiency before they reach production.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/benchmark"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-black text-black transition hover:brightness-110"
            >
              Benchmark an agent <ArrowRight size={17} />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-full border border-white/12 px-6 py-3.5 text-sm font-bold text-white transition hover:border-white/25"
            >
              See how it works
            </a>
          </div>

          <p className="mt-6 text-sm text-[var(--muted)]">
            V1 is built for remote agent API endpoints. No arbitrary code execution required.
          </p>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-[var(--surface)] p-5 shadow-2xl shadow-black/30">
          <div className="flex items-start justify-between border-b border-white/8 pb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">BENCHRX Score</p>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-6xl font-black tracking-[-0.06em]">91</span>
                <span className="pb-2 text-sm font-bold text-[var(--muted)]">/ 100</span>
              </div>
            </div>
            <div className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/8 px-3 py-1.5 text-xs font-bold text-[var(--accent)]">
              Production ready
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-5">
            {signals.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-white/8 bg-[var(--surface-2)] p-4">
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-sm text-[var(--muted)]">{label}</span>
                  <Icon size={16} className="text-[var(--accent)]" />
                </div>
                <p className="text-2xl font-black">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm">
            <div className="flex items-center justify-between py-1.5"><span className="text-[var(--muted)]">Tests passed</span><strong>47 / 50</strong></div>
            <div className="flex items-center justify-between py-1.5"><span className="text-[var(--muted)]">Average latency</span><strong>2.1s</strong></div>
            <div className="flex items-center justify-between py-1.5"><span className="text-[var(--muted)]">Critical failures</span><strong>0</strong></div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-white/8 bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">How it works</p>
            <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] sm:text-4xl">Evidence, not claims.</h2>
            <p className="mt-4 text-lg leading-8 text-[var(--muted)]">
              Connect an agent endpoint. BENCHRX runs repeatable scenarios, records what actually happened, and turns the evidence into a clear production scorecard.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ["01", "Connect", "Submit an agent API endpoint and describe what the agent is supposed to do."],
              ["02", "Test", "Run deterministic and model judged scenarios across reliability, safety and task success."],
              ["03", "Prove", "Receive a transparent scorecard showing what passed, what failed and why."],
            ].map(([number, title, description]) => (
              <article key={number} className="rounded-3xl border border-white/8 bg-[var(--surface)] p-6">
                <p className="text-xs font-black text-[var(--accent)]">{number}</p>
                <h3 className="mt-8 text-xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-[var(--muted)]">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl items-center justify-between px-6 py-10 text-sm text-[var(--muted)]">
        <span>© 2026 BENCHRX</span>
        <span>Built for production AI agents.</span>
      </footer>
    </main>
  );
}
