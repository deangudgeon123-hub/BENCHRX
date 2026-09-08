import { requireAdmin } from "@/lib/server/admin";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { ArrowLeft, Bot, Braces, CheckCircle2, Clock3, FlaskConical, ShieldAlert, XCircle } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

type AgentRow = {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
};

type RunRow = {
  suite_version: string | null;
  scoring_policy_version: string | null;
  id: string;
  status: string;
  production_score: number | null;
  task_success_score: number | null;
  reliability_score: number | null;
  safety_score: number | null;
  efficiency_score: number | null;
  avg_latency_ms: number | null;
  created_at: string;
  completed_at: string | null;
  agents: AgentRow | AgentRow[] | null;
};

type TestCase = {
  key: string;
  title: string;
  category: string;
  description: string | null;
};

type AIJudge = {
  status?: string;
  model?: string;
  dimension?: string;
  score?: number;
  passed?: boolean;
  confidence?: number;
  reason?: string;
  error?: string;
};

type RawResponse = {
  http_status?: number;
  body?: unknown;
  responses?: unknown[];
  error?: string | null;
  first_error?: string | null;
  second_error?: string | null;
  score_included?: boolean;
  benchrx_diagnostic?: boolean;
  benchrx_suite_version?: string;
  ai_judge?: AIJudge;
  [key: string]: unknown;
};

type ResultRow = {
  id: string;
  passed: boolean | null;
  score: number | null;
  latency_ms: number | null;
  judge_reason: string | null;
  raw_response: RawResponse | null;
  test_cases: TestCase | TestCase[] | null;
};

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function pretty(value: string) {
  return value.replace(/_/g, " ").replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function extractAgentText(raw: RawResponse | null): string {
  if (!raw) return "";
  const body = raw.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const response = (body as Record<string, unknown>).response;
    if (typeof response === "string") return response.trim();
  }
  return "";
}

function findHttpStatus(raw: RawResponse | null): number | null {
  if (!raw) return null;
  if (typeof raw.http_status === "number") return raw.http_status;
  if (Array.isArray(raw.responses)) {
    for (const response of raw.responses) {
      if (response && typeof response === "object" && typeof (response as Record<string, unknown>).http_status === "number") {
        return Number((response as Record<string, unknown>).http_status);
      }
    }
  }
  return null;
}

function hasTransportError(raw: RawResponse | null) {
  if (!raw) return false;
  return Boolean(raw.error || raw.first_error || raw.second_error);
}

function observedLabel(result: ResultRow) {
  const kind=result.raw_response?.outcome_type;
  const label=kind === "connector_diagnostic" ? "Connector diagnostic" : kind === "unobserved" ? "Unobserved" : kind === "inconclusive" ? "Inconclusive" : result.passed ? "Agent pass" : "Agent fail";
  return {label,tone:"border-white/10 bg-white/5 text-slate-300"};
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/8 bg-black/30 p-4 text-xs leading-6 text-slate-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function AdminRunDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing server database configuration");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: runData } = await supabase
    .from("benchmark_runs")
    .select("id,status,production_score,task_success_score,reliability_score,safety_score,efficiency_score,avg_latency_ms,created_at,completed_at,suite_version,scoring_policy_version,agents(id,name,slug,category,description)")
    .eq("id", id)
    .single();

  if (!runData) notFound();
  const run = runData as RunRow;
  const agent = first(run.agents);

  const { data: resultData, error } = await supabase
    .from("benchmark_results")
    .select("id,passed,score,latency_ms,observed,evidence_complete,outcome_type,score_included,test_snapshot,execution_metadata")
    .eq("benchmark_run_id", id)
    .order("created_at", { ascending: true });

  if (error) throw new Error("Unable to load run diagnostics");
  const results = (resultData ?? []).map((r) => ({...r, judge_reason: "See recorded verdict and trusted execution metadata", test_cases: {key:r.test_snapshot?.key, title:r.test_snapshot?.title, category:r.test_snapshot?.category, description:null}, raw_response: {outcome_type:r.outcome_type,observed:r.observed,evidence_complete:r.evidence_complete,score_included:r.score_included,execution:r.execution_metadata}})) as ResultRow[];
  const suspicious = results.filter((result) => observedLabel(result).label === "Unobserved / upstream").length;
  const suiteVersion = `${run.suite_version ?? "legacy-unknown"} / ${run.scoring_policy_version ?? "legacy-unversioned"}`;

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-white">
          <ArrowLeft size={16} /> Back to admin
        </Link>

        <div className="mt-8 flex flex-col gap-6 border-b border-white/8 pb-9 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[var(--accent)]">
              <FlaskConical size={14} /> Run {run.id.slice(0, 8)} · Suite {String(suiteVersion)}
            </div>
            <h1 className="mt-4 text-4xl font-black tracking-[-0.045em] sm:text-5xl">{agent?.name ?? "Unknown agent"}</h1>
            <p className="mt-3 text-sm text-[var(--muted)]">{agent?.category ?? "—"} · {formatDate(run.completed_at ?? run.created_at)}</p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-100/80">
            Diagnostic classification below is display-only. It does not change benchmark scoring.
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Production", run.production_score],
            ["Task", run.task_success_score],
            ["Reliability", run.reliability_score],
            ["Safety", run.safety_score],
            ["Efficiency", run.efficiency_score],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-3xl border border-white/8 bg-[var(--surface)] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p>
              <p className="mt-3 text-3xl font-black">{value ?? "—"}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-6">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em] text-[var(--muted)]"><Bot size={15} /> Agent endpoint</div>
            <p className="mt-3 break-all font-mono text-xs leading-6 text-slate-300">{"Connection details are private"}</p>
          </div>
          <div className={`rounded-3xl border p-6 ${suspicious > 0 ? "border-amber-500/20 bg-amber-500/10" : "border-white/8 bg-[var(--surface)]"}`}>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em] text-[var(--muted)]"><ShieldAlert size={15} /> Unobserved candidates</div>
            <p className="mt-3 text-3xl font-black">{suspicious}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">No agent text plus transport error or non-2xx response.</p>
          </div>
        </div>

        <div className="mt-8 space-y-4">
          {results.map((result) => {
            const test = first(result.test_cases);
            const state = observedLabel(result);
            const agentText = extractAgentText(result.raw_response);
            const httpStatus = findHttpStatus(result.raw_response);
            const ai = result.raw_response?.ai_judge;

            return (
              <details key={result.id} className="group rounded-3xl border border-white/8 bg-[var(--surface)] open:border-white/12">
                <summary className="cursor-pointer list-none px-5 py-5 sm:px-6">
                  <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr_0.6fr_0.7fr] lg:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {result.passed ? <CheckCircle2 size={17} className="text-emerald-300" /> : <XCircle size={17} className="text-red-300" />}
                        <p className="font-black text-white">{test?.title ?? "Unknown test"}</p>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">{test?.key ?? result.id} · {pretty(test?.category ?? "unknown")}</p>
                    </div>
                    <div><p className="text-xs text-[var(--muted)]">HTTP</p><p className="mt-1 font-black">{httpStatus ?? "—"}</p></div>
                    <div><p className="text-xs text-[var(--muted)]">Latency</p><p className="mt-1 font-black tabular-nums">{result.latency_ms ? `${Number(result.latency_ms).toLocaleString()} ms` : "—"}</p></div>
                    <div className="lg:text-right"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${state.tone}`}>{state.label}</span></div>
                  </div>
                </summary>

                <div className="border-t border-white/8 px-5 py-6 sm:px-6">
                  <div className="grid gap-5 xl:grid-cols-2">
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)]"><Braces size={14} /> Evaluator decision</div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
                        <p className="text-sm font-bold text-white">{result.judge_reason ?? "No evaluator reason recorded"}</p>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                          <span>Score: {result.score ?? "—"}</span>
                          <span>Scored: {result.raw_response?.score_included === false ? "No" : "Yes"}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)]"><Bot size={14} /> Extracted agent text</div>
                      <div className="min-h-24 rounded-2xl border border-white/8 bg-white/[0.025] p-4 text-sm leading-6 text-slate-200">
                        {agentText || <span className="text-amber-300">No agent response text extracted.</span>}
                      </div>
                    </div>
                  </div>

                  {ai ? (
                    <div className="mt-5 rounded-2xl border border-violet-500/20 bg-violet-500/10 p-4">
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-violet-200">Shadow AI judgment</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-4">
                        <div><p className="text-xs text-violet-100/60">Status</p><p className="mt-1 font-bold">{ai.status ?? "—"}</p></div>
                        <div><p className="text-xs text-violet-100/60">Score</p><p className="mt-1 font-bold">{ai.score ?? "—"}</p></div>
                        <div><p className="text-xs text-violet-100/60">Confidence</p><p className="mt-1 font-bold">{typeof ai.confidence === "number" ? `${Math.round(ai.confidence * (ai.confidence <= 1 ? 100 : 1))}%` : "—"}</p></div>
                        <div><p className="text-xs text-violet-100/60">Dimension</p><p className="mt-1 font-bold">{ai.dimension ?? "—"}</p></div>
                      </div>
                      {ai.reason ? <p className="mt-3 text-sm leading-6 text-violet-50/80">{ai.reason}</p> : null}
                    </div>
                  ) : null}

                  <div className="mt-5">
                    <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)]"><Clock3 size={14} /> Trusted execution metadata</div>
                    <JsonBlock value={result.raw_response} />
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </main>
  );
}
