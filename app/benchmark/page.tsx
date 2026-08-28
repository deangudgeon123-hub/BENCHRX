import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export default function BenchmarkPage() {
  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-3xl px-6 py-20">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-white">
          <ArrowLeft size={16} /> Back
        </Link>

        <div className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">New benchmark</p>
          <h1 className="mt-4 text-4xl font-black tracking-[-0.045em] sm:text-5xl">Connect an agent.</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            This is the V1 submission shell. Next we will wire these fields into Supabase and the Python benchmark runner.
          </p>
        </div>

        <form className="mt-10 space-y-5 rounded-3xl border border-white/8 bg-[var(--surface)] p-6 sm:p-8">
          <label className="block">
            <span className="mb-2 block text-sm font-bold">Agent name</span>
            <input
              type="text"
              placeholder="Invoice Chaser"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold">Category</span>
            <select className="w-full rounded-2xl border border-white/10 bg-[#0b0e12] px-4 py-3.5 text-white outline-none transition focus:border-[var(--accent)]/50">
              <option>Customer support</option>
              <option>Sales</option>
              <option>Finance</option>
              <option>Research</option>
              <option>Coding</option>
              <option>General</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold">Agent API endpoint</span>
            <input
              type="url"
              placeholder="https://your-agent.com/api/message"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold">What should this agent do?</span>
            <textarea
              rows={5}
              placeholder="Describe the agent's intended job, limits and expected behaviour."
              className="w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
            />
          </label>

          <button
            type="button"
            className="w-full rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-black text-black transition hover:brightness-110"
          >
            Continue to benchmark
          </button>

          <p className="text-center text-xs leading-5 text-[var(--muted)]">
            No test will run yet. Backend connection comes next.
          </p>
        </form>
      </section>
    </main>
  );
}
