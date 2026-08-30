import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CheckCircle2,
  CircleGauge,
  Clock3,
  Eye,
  History,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { BenchmarkPending } from "@/components/benchmark-pending";
import { RerunBenchmarkButton } from "@/components/rerun-benchmark-button";

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

type ResultRow = {
  id: string;
  passed: boolean | null;
  score: number | null;
  latency_ms: number | null;
  judge_reason: string | null;
  raw_response: { ai_judge?: AIJudge; [key: string]: unknown } | null;
  test_cases: TestCase | TestCase[] | null;
};

type RunRow = {
  id: string;
  status: string;
  production_score: number | null;
  task_success_score: number | null;
  reliability_score: number | null;
  safety_score: number | null;
  error_handling_score: number | null;
  efficiency_score: number | null;
  avg_latency_ms: number | null;
  completed_at: string | null;
  created_at: string;
};

function scoreLabel(score: number) {
  if (score >= 90) return "Production ready";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Needs review";
  return "High risk";
}

function scoreSummary(score: number) {
  if (score >= 90) return "Strong performance across the current BENCHRX blind resilience checks.";
  if (score >= 75) return "Good overall performance, with some resilience areas worth reviewing before wider deployment.";
  if (score >= 60) return "Several resilience checks need attention before this agent should be treated as production ready.";
  return "Material weaknesses were found in the current BENCHRX blind resilience checks.";
}

function prettyCategory(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const score = Math.max(0, Math.min(100, Number(value ?? 0)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="font-semibold text-white">{label}</span>
        <span className="font-black tabular-nums text-white">{score.toFixed(0)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export default async function AgentScorecardPage({ params }: PageProps) {
  const { slug } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) throw new Error("Missing Supabase public environment variables");

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

  const { data: historyData } = await supabase
    .from("benchmark_runs")
    .select("id,status,production_score,task_success_score,reliability_score,safety_score,error_handling_score,efficiency_score,avg_latency_ms,completed_at,created_at")
    .eq("agent_id", agent.id)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(10);

  const history = (historyData ?? []) as RunRow[];
  const run = history[0] ?? null;
  const previousRun = history[1] ?? null;

  let results: ResultRow[] = [];
  if (run) {
    const { data } = await supabase
      .from("benchmark_results")
      .select("id,passed,score,latency_ms,judge_reason,raw_response,test_cases(key,title,category,description)")
      .eq("benchmark_run_id", run.id)
      .order("created_at", { ascending: true });

    results = (data ?? []) as ResultRow[];
  }

  const productionScore = Number(run?.production_score ?? 0);
  const previousScore = previousRun ? Number(previousRun.production_score ?? 0) : null;
  const scoreDelta = previousScore === null ? null : productionScore - previousScore;
  const passedCount = results.filter((result) => result.passed).length;
  const failedCount = results.length - passedCount;
  const aiResults = results
    .map((result) => ({
      result,
      testCase: Array.isArray(result.test_cases) ? result.test_cases[0] : result.test_cases,
      judge: result.raw_response?.ai_judge,
    }))
    .filter((item) => item.judge);
  const completedAIResults = aiResults.filter((item) => item.judge?.status === "completed");

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
        <Link href="/benchmark" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-white">
          <ArrowLeft size={16} /> Back to benchmarks
        </Link>

        <div className="mt-10 flex flex-col gap-7 border-b border-white/8 pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{prettyCategory(agent.category)}</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]"><ShieldCheck size={14} /> Independently benchmarked</span>
            </div>
            <h1 className="mt-5 text-4xl font-black tracking-[-0.045em] sm:text-6xl">{agent.name}</h1>
            {agent.description ? <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">{agent.description}</p> : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end lg:flex-col lg:items-end">
            {run ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3 text-sm text-[var(--muted)]">
                <p className="text-xs font-bold uppercase tracking-[0.14em]">Last verified</p>
                <p className="mt-1 font-bold text-white">{formatDate(run.completed_at)}</p>
              </div>
            ) : null}
            <RerunBenchmarkButton slug={agent.slug} />
          </div>
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
                  <p className="mt-1 text-sm leading-6 text-emerald-100/70">Latest blind resilience run completed successfully.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-100/80"><ShieldCheck size={14} /> Verified result</div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="relative overflow-hidden rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-8 sm:p-10">
                <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-[var(--accent)]/8 blur-3xl" />
                <div className="relative">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]"><CircleGauge size={16} /> Latest production score</div>
                  <div className="mt-7 flex items-end gap-3">
                    <span className="text-8xl font-black leading-none tracking-[-0.07em] text-white sm:text-9xl">{productionScore.toFixed(0)}</span>
                    <span className="mb-3 text-xl font-bold text-[var(--muted)]">/100</span>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <span className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 py-1.5 text-sm font-black text-[var(--accent)]">{scoreLabel(productionScore)}</span>
                    {scoreDelta !== null ? (
                      <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-black ${scoreDelta > 0 ? "bg-emerald-500/10 text-emerald-200" : scoreDelta < 0 ? "bg-red-500/10 text-red-200" : "bg-white/5 text-[var(--muted)]"}`}>
                        {scoreDelta > 0 ? <TrendingUp size={15} /> : scoreDelta < 0 ? <TrendingDown size={15} /> : null}
                        {scoreDelta > 0 ? "+" : ""}{scoreDelta.toFixed(0)} vs previous
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-4 max-w-md text-sm leading-6 text-[var(--muted)]">{scoreSummary(productionScore)}</p>
                  <div className="mt-8 grid grid-cols-2 gap-3 border-t border-white/8 pt-6 sm:grid-cols-3">
                    <div><p className="text-xs text-[var(--muted)]">Passed</p><p className="mt-1 text-xl font-black text-white">{passedCount}</p></div>
                    <div><p className="text-xs text-[var(--muted)]">Failed</p><p className={`mt-1 text-xl font-black ${failedCount > 0 ? "text-red-300" : "text-white"}`}>{failedCount}</p></div>
                    <div><p className="text-xs text-[var(--muted)]">Avg latency</p><p className="mt-1 text-xl font-black tabular-nums text-white">{Number(run.avg_latency_ms ?? 0).toLocaleString()} ms</p></div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-8 sm:p-10">
                <div className="flex items-center justify-between gap-4">
                  <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Score breakdown</p><h2 className="mt-2 text-2xl font-black">Blind resilience</h2></div>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-200">Active</span>
                </div>
                <div className="mt-7 space-y-6">
                  <ScoreBar label="Task success" value={run.task_success_score} />
                  <ScoreBar label="Reliability" value={run.reliability_score} />
                  <ScoreBar label="Safety" value={run.safety_score} />
                  <ScoreBar label="Error handling" value={run.error_handling_score} />
                  <ScoreBar label="Efficiency" value={run.efficiency_score} />
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-6">
                <div className="flex items-center justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"><Eye size={19} /></div><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-200">Active</span></div>
                <h3 className="mt-5 text-lg font-black">Blind resilience</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Universal checks for reliability, safety, ambiguity, malformed input and repeatability.</p>
              </div>
              <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-6">
                <div className="flex items-center justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white"><Target size={19} /></div><span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">Planned</span></div>
                <h3 className="mt-5 text-lg font-black">Declared purpose</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Tests whether the agent actually performs the job and limits its developer declares.</p>
              </div>
              <div className="rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-6">
                <div className="flex items-center justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"><Sparkles size={19} /></div><span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-200">Shadow</span></div>
                <h3 className="mt-5 text-lg font-black">AI evaluation</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">GPT judge is now running on selected tests. Its result is visible below but does not affect the production score yet.</p>
              </div>
            </div>

            {aiResults.length > 0 ? (
              <div className="mt-10">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">AI evaluation</p>
                    <h2 className="mt-3 flex items-center gap-2 text-3xl font-black tracking-[-0.035em]"><Sparkles size={24} /> Shadow judge results</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">These AI judgments are being calibrated and do not affect the BENCHRX production score yet.</p>
                  </div>
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-200">{completedAIResults.length}/{aiResults.length} completed</span>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {aiResults.map(({ result, testCase, judge }) => (
                    <div key={`ai-${result.id}`} className="rounded-3xl border border-white/8 bg-[var(--surface)] p-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{judge?.dimension ? prettyCategory(judge.dimension) : testCase?.title ?? "AI judge"}</p>
                          <h3 className="mt-2 text-lg font-black text-white">{testCase?.title ?? "AI evaluation"}</h3>
                        </div>
                        {judge?.status === "completed" ? (
                          <div className="text-right"><p className="text-xs text-[var(--muted)]">AI score</p><p className="text-3xl font-black tabular-nums text-white">{Number(judge.score ?? 0).toFixed(0)}</p></div>
                        ) : (
                          <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-200">{prettyCategory(judge?.status ?? "error")}</span>
                        )}
                      </div>

                      {judge?.status === "completed" ? (
                        <>
                          <p className="mt-5 text-sm leading-6 text-[var(--muted)]">{judge.reason}</p>
                          <div className="mt-5 flex flex-wrap gap-2 border-t border-white/8 pt-4 text-xs text-[var(--muted)]">
                            <span className="rounded-full bg-white/5 px-3 py-1.5">Model: <span className="font-bold text-white">{judge.model ?? "OpenAI judge"}</span></span>
                            <span className="rounded-full bg-white/5 px-3 py-1.5">Confidence: <span className="font-bold text-white">{Math.round(Number(judge.confidence ?? 0) * 100)}%</span></span>
                            <span className={`rounded-full px-3 py-1.5 font-bold ${judge.passed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"}`}>{judge.passed ? "AI pass" : "AI fail"}</span>
                          </div>
                        </>
                      ) : (
                        <p className="mt-5 text-sm leading-6 text-red-200/80">{judge?.error ?? "The AI judge did not return a completed result."}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Evidence</p><h2 className="mt-3 text-3xl font-black tracking-[-0.035em]">Blind resilience evidence</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Observed behaviour from the latest completed run.</p></div>
                <p className="text-sm text-[var(--muted)]">Run {run.id.slice(0, 8)}</p>
              </div>
              <div className="mt-6 overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)]">
                {results.map((result, index) => {
                  const testCase = Array.isArray(result.test_cases) ? result.test_cases[0] : result.test_cases;
                  return (
                    <div key={result.id} className={`flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7 ${index !== results.length - 1 ? "border-b border-white/8" : ""}`}>
                      <div className="flex min-w-0 items-start gap-4">
                        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${result.passed ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-red-500/20 bg-red-500/10 text-red-300"}`}>{result.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}</div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-white">{testCase?.title ?? "BENCHRX test"}</p>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${result.passed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"}`}>{result.passed ? "Passed" : "Failed"}</span>
                            <span className="rounded-full border border-[var(--accent)]/15 bg-[var(--accent)]/8 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--accent)]">Blind</span>
                            {result.raw_response?.ai_judge ? <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-200">AI judged</span> : null}
                            {testCase?.category ? <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{prettyCategory(testCase.category)}</span> : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{result.judge_reason ?? testCase?.description ?? "Benchmark check completed."}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-6 pl-13 text-sm sm:pl-0">
                        <div className="text-right"><p className="text-xs text-[var(--muted)]">Latency</p><p className="mt-1 font-bold tabular-nums text-white">{Number(result.latency_ms ?? 0).toLocaleString()} ms</p></div>
                        <div className="min-w-12 text-right"><p className="text-xs text-[var(--muted)]">Score</p><p className="mt-1 font-black tabular-nums text-white">{Number(result.score ?? 0).toFixed(0)}</p></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-10">
              <div className="flex items-end justify-between gap-4">
                <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">History</p><h2 className="mt-3 flex items-center gap-2 text-3xl font-black tracking-[-0.035em]"><History size={25} /> Benchmark history</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Every completed run for this agent is kept so changes can be tracked over time.</p></div>
                <span className="text-xs text-[var(--muted)]">{history.length} run{history.length === 1 ? "" : "s"}</span>
              </div>

              <div className="mt-6 overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)]">
                {history.map((item, index) => {
                  const score = Number(item.production_score ?? 0);
                  const next = history[index + 1];
                  const delta = next ? score - Number(next.production_score ?? 0) : null;
                  return (
                    <div key={item.id} className={`flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${index !== history.length - 1 ? "border-b border-white/8" : ""}`}>
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-full ${index === 0 ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "bg-white/5 text-[var(--muted)]"}`}><Clock3 size={17} /></div>
                        <div><p className="font-black text-white">{index === 0 ? "Latest run" : `Previous run ${index}`}</p><p className="mt-1 text-xs text-[var(--muted)]">{formatDate(item.completed_at)}</p></div>
                      </div>
                      <div className="flex items-center gap-5 pl-12 sm:pl-0">
                        {delta !== null ? <span className={`text-sm font-black ${delta > 0 ? "text-emerald-300" : delta < 0 ? "text-red-300" : "text-[var(--muted)]"}`}>{delta > 0 ? "+" : ""}{delta.toFixed(0)}</span> : null}
                        <div className="text-right"><p className="text-xs text-[var(--muted)]">Score</p><p className="mt-1 text-2xl font-black tabular-nums text-white">{score.toFixed(0)}</p></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-4 rounded-3xl border border-white/8 bg-white/[0.025] p-6 text-sm leading-6 text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-3xl">This score currently reflects BENCHRX blind resilience checks only. AI shadow judgments are displayed for calibration but are not yet included in the production score.</p>
              <Link href="/benchmark" className="shrink-0 rounded-full border border-white/12 px-5 py-2.5 font-bold text-white transition hover:border-[var(--accent)]/60">Benchmark another agent</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
