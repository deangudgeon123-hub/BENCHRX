"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";

type RecentBenchmark = {
  name: string;
  slug: string;
  category: string;
  createdAt: string;
  status: string;
  score: number | null;
};

type ConnectionType = "native" | "custom" | "gradio";

function prettyCategory(value: string) {
  return value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function BenchmarkPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionType, setConnectionType] = useState<ConnectionType>("native");
  const [connectionStatus, setConnectionStatus] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ name: string; slug: string } | null>(null);
  const [recent, setRecent] = useState<RecentBenchmark[]>([]);

  async function loadRecent() {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setRecent(data.recent ?? []);
    } catch {
      // The submission flow should stay usable even if history is unavailable.
    }
  }

  useEffect(() => {
    loadRecent();
    const timer = window.setInterval(loadRecent, 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function testConnection(formElement: HTMLFormElement) {
    const form = new FormData(formElement);
    setConnectionStatus("");
    setError("");

    const payload =
      connectionType === "gradio"
        ? {
            connectionType: "gradio",
            spaceUrl: String(form.get("spaceUrl") ?? "").trim(),
            apiName: String(form.get("apiName") ?? "chat").trim(),
            gradioInputs: String(form.get("gradioInputs") ?? '["{{message}}"]'),
            outputIndex: String(form.get("outputIndex") ?? "0").trim(),
          }
        : {
            connectionType: "custom",
            targetUrl: String(form.get("targetUrl") ?? "").trim(),
            requestPath: String(form.get("requestPath") ?? "message").trim(),
            responsePath: String(form.get("responsePath") ?? "response").trim(),
            fixedBody: String(form.get("fixedBody") ?? "{}").trim(),
          };

    if (connectionType === "gradio" && !payload.spaceUrl) {
      setError("Enter the Gradio Space URL first.");
      return;
    }
    if (connectionType === "custom" && !("targetUrl" in payload && payload.targetUrl)) {
      setError("Enter the custom agent target URL first.");
      return;
    }

    setIsTestingConnection(true);
    try {
      const response = await fetch("/api/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Connection test failed.");
      }

      const preview = String(data.response ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
      setConnectionStatus(preview ? `Connected. Response: ${preview}` : "Connected successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed.");
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess(null);
    setIsSubmitting(true);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      name: String(form.get("name") ?? ""),
      category: String(form.get("category") ?? "general"),
      description: String(form.get("description") ?? ""),
      connectionType,
      endpointUrl: String(form.get("endpointUrl") ?? ""),
      targetUrl: String(form.get("targetUrl") ?? ""),
      requestPath: String(form.get("requestPath") ?? "message"),
      responsePath: String(form.get("responsePath") ?? "response"),
      fixedBody: String(form.get("fixedBody") ?? "{}"),
      spaceUrl: String(form.get("spaceUrl") ?? ""),
      apiName: String(form.get("apiName") ?? "chat"),
      gradioInputs: String(form.get("gradioInputs") ?? '["{{message}}"]'),
      outputIndex: String(form.get("outputIndex") ?? "0"),
    };

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not start this benchmark.");
      }

      setSuccess({ name: data.agent.name, slug: data.agent.slug });
      formElement.reset();
      setConnectionType("native");
      setConnectionStatus("");
      await loadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-white"
        >
          <ArrowLeft size={16} /> Back to BENCHRX
        </Link>

        <div className="mt-10 max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">
              New benchmark
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--muted)]">
              <ShieldCheck size={14} /> Independent production-readiness test
            </span>
          </div>

          <h1 className="mt-5 text-4xl font-black tracking-[-0.05em] sm:text-6xl">
            Test a real AI agent.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            Give BENCHRX a public agent endpoint and a short description of its job. We&apos;ll run the benchmark automatically and produce a shareable scorecard.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ["1", "Connect", "Add the agent endpoint"],
            ["2", "Benchmark", "BENCHRX runs the suite"],
            ["3", "Scorecard", "Review the evidence"],
          ].map(([number, title, description]) => (
            <div key={number} className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/8 text-xs font-black text-white">
                  {number}
                </span>
                <p className="font-black text-white">{title}</p>
              </div>
              <p className="mt-2 pl-10 text-xs leading-5 text-[var(--muted)]">{description}</p>
            </div>
          ))}
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-8 overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)]"
        >
          <div className="border-b border-white/8 p-6 sm:p-8">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">Agent profile</p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
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
                <select
                  name="category"
                  defaultValue="general"
                  className="w-full rounded-2xl border border-white/10 bg-[#0b0e12] px-4 py-3.5 text-white outline-none transition focus:border-[var(--accent)]/50"
                >
                  <option value="customer-support">Customer support</option>
                  <option value="sales">Sales</option>
                  <option value="finance">Finance</option>
                  <option value="research">Research</option>
                  <option value="coding">Coding</option>
                  <option value="general">General</option>
                </select>
              </label>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-bold">What is this agent supposed to do?</span>
              <textarea
                name="description"
                rows={4}
                placeholder="Describe its intended job, important limits and expected behaviour."
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
              />
              <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">
                This will later help BENCHRX generate purpose-specific tests. Universal blind resilience checks are evaluated separately.
              </span>
            </label>
          </div>

          <div className="p-6 sm:p-8">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">Connection</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["native", "BENCHRX endpoint", "Sends a message field and reads a response field."],
                ["custom", "Custom HTTP API", "Map BENCHRX onto another public JSON API shape."],
                ["gradio", "Hugging Face / Gradio", "Handle Gradio queue submission and result streaming."],
              ].map(([type, title, description]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setConnectionType(type as ConnectionType);
                    setConnectionStatus("");
                    setError("");
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    connectionType === type
                      ? "border-[var(--accent)]/50 bg-[var(--accent)]/10"
                      : "border-white/10 bg-black/20 hover:border-white/20"
                  }`}
                >
                  <p className="font-black text-white">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>
                </button>
              ))}
            </div>

            {connectionType === "native" ? (
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-bold">Agent API endpoint</span>
                <input
                  name="endpointUrl"
                  type="url"
                  required
                  placeholder="https://your-agent.com/api/message"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
                />
                <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">
                  BENCHRX sends <span className="font-mono text-white/70">{"{ message: \"...\" }"}</span> and expects a <span className="font-mono text-white/70">response</span> field back.
                </span>
              </label>
            ) : connectionType === "custom" ? (
              <div className="mt-5 rounded-2xl border border-white/8 bg-black/15 p-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold">Target HTTPS endpoint</span>
                  <input
                    name="targetUrl"
                    type="url"
                    required
                    placeholder="https://api.example.com/v1/chat/completions"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
                  />
                </label>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold">Message JSON path</span>
                    <input
                      name="requestPath"
                      type="text"
                      defaultValue="message"
                      placeholder="messages[0].content"
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 font-mono text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-bold">Response JSON path</span>
                    <input
                      name="responsePath"
                      type="text"
                      defaultValue="response"
                      placeholder="choices[0].message.content"
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 font-mono text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
                    />
                  </label>
                </div>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-bold">Fixed request JSON (optional)</span>
                  <textarea
                    name="fixedBody"
                    rows={5}
                    defaultValue="{}"
                    placeholder={'{\n  "model": "example-model"\n}'}
                    className="w-full resize-y rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 font-mono text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
                  />
                  <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">
                    Add fields the API always requires, such as model or role. BENCHRX writes each test message into the message path above.
                  </span>
                </label>

                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  Dot paths and array indexes are supported. Public unauthenticated JSON endpoints only in this first connector version. Private/local addresses and redirects are blocked.
                </p>

                <button
                  type="button"
                  disabled={isTestingConnection}
                  onClick={(event) => {
                    const form = event.currentTarget.closest("form");
                    if (form) void testConnection(form);
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-white transition hover:border-white/20 disabled:opacity-60"
                >
                  {isTestingConnection ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />}
                  {isTestingConnection ? "Testing connection..." : "Test connection"}
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/8 bg-black/15 p-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold">Gradio Space URL</span>
                  <input
                    name="spaceUrl"
                    type="url"
                    required
                    placeholder="https://example-space.hf.space"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
                  />
                </label>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold">Gradio API name</span>
                    <input
                      name="apiName"
                      type="text"
                      defaultValue="chat"
                      placeholder="chat"
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 font-mono text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[var(--accent)]/50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold">Output index</span>
                    <input
                      name="outputIndex"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue="0"
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 font-mono text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
                    />
                  </label>
                </div>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-bold">Gradio input JSON</span>
                  <textarea
                    name="gradioInputs"
                    rows={5}
                    defaultValue={'["{{message}}"]'}
                    className="w-full resize-y rounded-2xl border border-white/10 bg-black/20 px-4 py-3.5 font-mono text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
                  />
                  <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">
                    Enter the endpoint&apos;s input array in API order. Use <span className="font-mono text-white/70">{"{{message}}"}</span> where BENCHRX should insert each test prompt.
                  </span>
                </label>

                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  BENCHRX submits the Gradio queue job, follows its event ID and extracts the completed text response. Public unauthenticated Spaces only for now.
                </p>

                <button
                  type="button"
                  disabled={isTestingConnection}
                  onClick={(event) => {
                    const form = event.currentTarget.closest("form");
                    if (form) void testConnection(form);
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-white transition hover:border-white/20 disabled:opacity-60"
                >
                  {isTestingConnection ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />}
                  {isTestingConnection ? "Testing connection..." : "Test connection"}
                </button>
              </div>
            )}

            {connectionStatus ? (
              <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {connectionStatus}
              </div>
            ) : null}

            {error ? (
              <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
                <CheckCircle2 className="mt-0.5 shrink-0" size={19} />
                <div className="min-w-0">
                  <p className="font-black">Benchmark started for {success.name}.</p>
                  <p className="mt-1 leading-6 text-emerald-100/70">
                    BENCHRX is running the production-readiness suite now. The scorecard updates automatically when the run is ready.
                  </p>
                  <Link
                    href={`/agents/${success.slug}`}
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 px-4 py-2 font-black text-emerald-50 transition hover:border-emerald-200/50"
                  >
                    Watch benchmark <ArrowRight size={15} />
                  </Link>
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 py-4 text-sm font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Play size={17} />}
              {isSubmitting ? "Starting benchmark..." : "Run BENCHRX benchmark"}
            </button>

            <p className="mt-3 text-center text-xs leading-5 text-[var(--muted)]">
              The hosted worker starts automatically. No local backend is required.
            </p>
          </div>
        </form>

        <div className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--accent)]">History</p>
              <h2 className="mt-2 text-2xl font-black">Recent benchmarks</h2>
            </div>
            <p className="text-xs text-[var(--muted)]">Live status</p>
          </div>

          <div className="mt-5 overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)]">
            {recent.length === 0 ? (
              <p className="p-6 text-sm text-[var(--muted)]">Your latest benchmarks will appear here.</p>
            ) : (
              recent.map((item, index) => (
                <Link
                  key={item.slug}
                  href={`/agents/${item.slug}`}
                  className={`flex items-center justify-between gap-4 p-5 transition hover:bg-white/[0.03] ${
                    index !== recent.length - 1 ? "border-b border-white/8" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-black text-white">{item.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{prettyCategory(item.category)}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {item.status === "completed" ? (
                      <>
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-200">
                          Ready
                        </span>
                        <span className="min-w-9 text-right text-lg font-black tabular-nums text-white">
                          {Number(item.score ?? 0).toFixed(0)}
                        </span>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-[var(--muted)]">
                        <Clock3 size={13} /> {item.status === "running" ? "Running" : "Queued"}
                      </span>
                    )}
                    <ArrowRight size={15} className="text-white/30" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
