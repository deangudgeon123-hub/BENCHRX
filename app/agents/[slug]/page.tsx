import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CheckCircle2,
  CircleGauge,
  Clock3,
  ShieldCheck,
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
                <ShieldCheck size={14} /> Independent benchmark
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
            <div className="text-sm text-[var(--muted)]">
              Last verified <span className="font-bold text-white">{completedDate}</span>
            </div>
          ) : null}
        </div>

        {!run ? (
          <BenchmarkPending />
        ) : (
          <>
            <div className="mt-10 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 text-emerald-100">
              <p className="font-black">Benchmark ready</p>
              <p className="mt-1 text-sm text-emerald-100/70">Testing is complete and your BENCHRX score is ready below.</p>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
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

                  <p className="mt-5 text-lg font-black text-[var(--accent)]">
                    {scoreLabel(productionScore)}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    {passedCount}/{results.length} benchmark checks passed
                  </p>

                  <div className="mt-8 flex items-center gap-2 border-t border-white/8 pt-6 text-sm text-[var(--muted)]">
                    <Clock3 size={16} />
                    Average latency
                    <span className="ml-auto font-black tabular-nums text-white">
                      {Number(run.avg_latency_ms ?? 0).toLocaleString()} ms
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-8 sm:p-10">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Score breakdown
                </p>
                <div className="mt-7 space-y-6">
                  <ScoreBar label="Task success" value={run.task_success_score} />
                  <ScoreBar label="Reliability" value={run.reliability_score} />
                  <ScoreBar label="Safety" value={run.safety_score} />
                  <ScoreBar label="Error handling" value={run.error_handling_score} />
                  <ScoreBar label="Efficiency" value={run.efficiency_score} />
                </div>
              </div>
            </div>

            <div className="mt-10">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                    Test evidence
                  </p>
                  <h2 className="mt-3 text-3xl font-black tracking-[-0.035em]">What BENCHRX tested</h2>
                </div>
                <p className="hidden text-sm text-[var(--muted)] sm:block">
                  Run {run.id.slice(0, 8)}
                </p>
              </div>

              <div className="mt-6 overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)]">
                {results.map((result, index) => {
                  const testCase = Array.isArray(result.test_cases)
                    ? result.test_cases[0]
                    : result.test_cases;

                  return (
                    <div
                      key={result.id}
                      className={`flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7 ${
                        index !== results.length - 1 ? "border-b border-white/8" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-4">
                        {result.passed ? (
                          <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--accent)]" size={21} />
                        ) : (
                          <XCircle className="mt-0.5 shrink-0 text-red-400" size={21} />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-white">
                              {testCase?.title ?? "BENCHRX test"}
                            </p>
                            {testCase?.category ? (
                              <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                                {prettyCategory(testCase.category)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
                            {result.judge_reason ?? testCase?.description ?? "Benchmark check completed."}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-5 pl-9 text-sm sm:pl-0">
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

            <div className="mt-8 flex flex-col gap-3 rounded-3xl border border-white/8 bg-white/[0.025] p-6 text-sm leading-6 text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
              <p>
                BENCHRX scores reflect this specific benchmark run and should be considered alongside the agent&apos;s intended use and deployment controls.
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
