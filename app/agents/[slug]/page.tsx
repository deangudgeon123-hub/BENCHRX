import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CheckCircle2,
  CircleGauge,
  Clock3,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { BenchmarkPending } from "@/components/benchmark-pending";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

type TestCase = {
  key: string;
  title: string;
  category: string;
  description: string | null;
};

type ResultRow = {
  id: string;
  passed: boolean | null;
  score: number | null;
  latency_ms: number | null;
  judge_reason: string | null;
  test_cases: TestCase | TestCase[] | null;
};

function scoreLabel(score: number) {
  if (score >= 90) return "Production ready";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Needs review";
  return "High risk";
}

function scoreSummary(score: number) {
  if (score >= 90) return "Strong performance across the current BENCHRX core checks.";
  if (score >= 75) return "Good overall performance, with some areas worth reviewing before wider deployment.";
  if (score >= 60) return "Several checks need attention before this agent should be treated as production ready.";
  return "Material weaknesses were found in the current BENCHRX core checks.";
}

function prettyCategory(value: string) {
  return value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const score = Math.max(0, Math.min(100, Number(value ?? 0)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="font-semibold text-white">{label}</span>
        <span className="font-black tabular-nums text-white">{score.toFixed(0)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all"
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

export default async function AgentScorecardPage({ params }: PageProps) {
  const { slug } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing Supabase public environment variables");
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: agent } = await supabase
    .from("agents")
    .select("id,name,slug,description,category,created_at")
    .eq("slug", slug)
    .eq("is_public", true)
    .single();

  if (!agent) notFound();

  const { data: runs } = await supabase
    .from("benchmark_runs")
    .select(
      "id,status,production_score,task_success_score,reliability_score,safety_score,error_handling_score,efficiency_score,avg_latency_ms,completed_at,created_at"
    )
    .eq("agent_id", agent.id)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1);

  const run = runs?.[0] ?? null;

  let results: ResultRow[] = [];
  if (run) {
    const { data } = await supabase
      .from("benchmark_results")
      .select(
        "id,passed,score,latency_ms,judge_reason,test_cases(key,title,category,description)"
      )
      .eq("benchmark_run_id", run.id)
      .order("created_at", { ascending: true });

    results = (data ?? []) as ResultRow[];
  }

  const productionScore = Number(run?.production_score ?? 0);
  const passedCount = results.filter((result) => result.passed).length;
  const failedCount = results.length - passedCount;
  const completedDate = run?.completed_at
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(run.completed_at))
    : null;

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
        <Link
          href="/benchmark"
          className="inline-flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-white"
        >
          <ArrowLeft size={16} /> Back to benchmarks
        </Link>

        <div className="mt-10 flex flex-col gap-6 border-b border-white/8 pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                {prettyCategory(agent.category)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
                <ShieldCheck size={14} /> Independently benchmarked
              </span>
            </div>

            <h1 className="mt-5 text-4xl font-black tracking-[-0.045em] sm:text-6xl">
              {agent.name}
            </h1>

            {agent.description ? (
              <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
                {agent.description}
              </p>
            ) : null}
          </div>

          {completedDate ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3 text-sm text-[var(--muted)]">
              <p className="text-xs font-bold uppercase tracking-[0.14em]">Verification</p>
              <p className="mt-1">
                Last verified <span className="font-bold text-white">{completedDate}</span>
              </p>
            </div>
          ) : null}
        </div>

        {!run ? (
          <BenchmarkPending />
        ) : (
          <>
            <div className="mt-10 flex flex-col gap-4 rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={21} />
                <div>
                  <p className="font-black text-emerald-50">Benchmark ready</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-100/70">
                    BENCHRX completed the current core production-readiness checks for this agent.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-100/80">
                <ShieldCheck size={14} /> Verified result
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="relative overflow-hidden rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-8 sm:p-10">
                <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-[var(--accent)]/8 blur-3xl" />
                <div className="relative">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                    <CircleGauge size={16} /> BENCHRX production score
                  </div>

                  <div className="mt-7 flex items-end gap-3">
                    <span className="text-8xl font-black leading-none tracking-[-0.07em] text-white sm:text-9xl">
                      {productionScore.toFixed(0)}
                    </span>
                    <span className="mb-3 text-xl font-bold text-[var(--muted)]">/100</span>
                  </div>

                  <div className="mt-5 inline-flex rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 py-1.5 text-sm font-black text-[var(--accent)]">
                    {scoreLabel(productionScore)}
                  </div>
                  <p className="mt-4 max-w-md text-sm leading-6 text-[var(--muted)]">
                    {scoreSummary(productionScore)}
                  </p>

                  <div className="mt-8 grid grid-cols-2 gap-3 border-t border-white/8 pt-6 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-[var(--muted)]">Passed</p>
                      <p className="mt-1 text-xl font-black text-white">{passedCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Failed</p>
                      <p className={`mt-1 text-xl font-black ${failedCount > 0 ? "text-red-300" : "text-white"}`}>
                        {failedCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Avg latency</p>
                      <p className="mt-1 text-xl font-black tabular-nums text-white">
                        {Number(run.avg_latency_ms ?? 0).toLocaleString()} ms
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-8 sm:p-10">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                      Score breakdown
                    </p>
                    <h2 className="mt-2 text-2xl font-black">Core checks</h2>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-[var(--muted)]">
                    Current V1 suite
                  </span>
                </div>

                <div className="mt-7 space-y-6">
                  <ScoreBar label="Task success" value={run.task_success_score} />
                  <ScoreBar label="Reliability" value={run.reliability_score} />
                  <ScoreBar label="Safety" value={run.safety_score} />
                  <ScoreBar label="Error handling" value={run.error_handling_score} />
                  <ScoreBar label="Efficiency" value={run.efficiency_score} />
                </div>

                <div className="mt-8 rounded-2xl border border-white/8 bg-white/[0.025] p-4">
                  <div className="flex items-center gap-2 text-sm font-black text-white">
                    <Sparkles size={16} className="text-[var(--accent)]" /> AI evaluation layer
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    Purpose-specific quality, hallucination and deeper behavioural judging will appear here once the AI evaluation layer is enabled.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                    Evidence
                  </p>
                  <h2 className="mt-3 text-3xl font-black tracking-[-0.035em]">Core test evidence</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                    Each result below shows the observed behaviour used in this production-readiness score.
                  </p>
                </div>
                <p className="text-sm text-[var(--muted)]">Run {run.id.slice(0, 8)}</p>
              </div>

              <div className="mt-6 overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)]">
                {results.map((result, index) => {
                  const testCase = Array.isArray(result.test_cases)
                    ? result.test_cases[0]
                    : result.test_cases;

                  return (
                    <div
                      key={result.id}
                      className={`flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7 ${
                        index !== results.length - 1 ? "border-b border-white/8" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-4">
                        <div
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                            result.passed
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                              : "border-red-500/20 bg-red-500/10 text-red-300"
                          }`}
                        >
                          {result.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-white">
                              {testCase?.title ?? "BENCHRX test"}
                            </p>
                            <span
                              className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                                result.passed
                                  ? "bg-emerald-500/10 text-emerald-200"
                                  : "bg-red-500/10 text-red-200"
                              }`}
                            >
                              {result.passed ? "Passed" : "Failed"}
                            </span>
                            {testCase?.category ? (
                              <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                                {prettyCategory(testCase.category)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                            {result.judge_reason ?? testCase?.description ?? "Benchmark check completed."}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-6 pl-13 text-sm sm:pl-0">
                        <div className="text-right">
                          <p className="text-xs text-[var(--muted)]">Latency</p>
                          <p className="mt-1 font-bold tabular-nums text-white">
                            {Number(result.latency_ms ?? 0).toLocaleString()} ms
                          </p>
                        </div>
                        <div className="min-w-12 text-right">
                          <p className="text-xs text-[var(--muted)]">Score</p>
                          <p className="mt-1 font-black tabular-nums text-white">
                            {Number(result.score ?? 0).toFixed(0)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-4 rounded-3xl border border-white/8 bg-white/[0.025] p-6 text-sm leading-6 text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-3xl">
                This score reflects the current BENCHRX V1 core suite for this specific run. It is evidence of observed behaviour, not a guarantee of safety or suitability for every deployment.
              </p>
              <Link
                href="/benchmark"
                className="shrink-0 rounded-full border border-white/12 px-5 py-2.5 font-bold text-white transition hover:border-[var(--accent)]/60"
              >
                Benchmark another agent
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
