"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export default function BenchmarkPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ name: string; slug: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      category: String(form.get("category") ?? "general"),
      endpointUrl: String(form.get("endpointUrl") ?? ""),
      description: String(form.get("description") ?? ""),
    };

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save this agent.");
      }

      setSuccess({ name: data.agent.name, slug: data.agent.slug });
      event.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

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
            Add the agent you want BENCHRX to evaluate. For V1, the agent needs a reachable HTTP API endpoint.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-10 space-y-5 rounded-3xl border border-white/8 bg-[var(--surface)] p-6 sm:p-8">
          <label className="block">
            <span className="mb-2 block text-sm font-bold">Agent name</span>
            <input
              name="name"
              type="text"
              required
              placeholder="Invoice Chaser"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold">Category</span>
            <select name="category" defaultValue="general" className="w-full rounded-2xl border border-white/10 bg-[#0b0e12] px-4 py-3.5 text-white outline-none transition focus:border-[var(--accent)]/50">
              <option value="customer-support">Customer support</option>
              <option value="sales">Sales</option>
              <option value="finance">Finance</option>
              <option value="research">Research</option>
              <option value="coding">Coding</option>
              <option value="general">General</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold">Agent API endpoint</span>
            <input
              name="endpointUrl"
              type="url"
              required
              placeholder="https://your-agent.com/api/message"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold">What should this agent do?</span>
            <textarea
              name="description"
              rows={5}
              placeholder="Describe the agent's intended job, limits and expected behaviour."
              className="w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
            />
          </label>

          {error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
              <div>
                <p className="font-bold">{success.name} was saved and queued.</p>
                <p className="mt-1 text-emerald-100/70">BENCHRX has started the benchmark automatically. Free workers can take a little longer to wake up.</p>
                <Link
                  href={`/agents/${success.slug}`}
                  className="mt-3 inline-flex rounded-full border border-emerald-300/20 px-4 py-2 font-bold text-emerald-50 transition hover:border-emerald-200/50"
                >
                  Open scorecard
                </Link>
              </div>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 size={17} className="animate-spin" /> : null}
            {isSubmitting ? "Saving agent..." : "Save agent"}
          </button>

          <p className="text-center text-xs leading-5 text-[var(--muted)]">
            Saving queues the benchmark and triggers the hosted BENCHRX worker automatically.
          </p>
        </form>
      </section>
    </main>
  );
}
