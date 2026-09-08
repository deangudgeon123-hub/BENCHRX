import "server-only";
import { comparableRuns, readinessLabel } from "@/lib/measurement-view";
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
  suite_version: string | null;
  scoring_policy_version: string | null;
  readiness_status: string | null;
  readiness_reasons: string[] | null;
  coverage: Record<string, {observed: number; total: number; minimum: number}> | null;
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

function getTestCase(result: ResultRow) {
  return Array.isArray(result.test_cases) ? result.test_cases[0] : result.test_cases;
}

function outcomeType(result: ResultRow) {
  return typeof result.raw_response?.outcome_type === "string" ? result.raw_response.outcome_type : null;
}

function isConnectorDiagnostic(result: ResultRow) {
  return getTestCase(result)?.category === "error_handling" || outcomeType(result) === "connector_diagnostic" || result.raw_response?.benchrx_diagnostic === true;
}

function isUnobserved(result: ResultRow) {
  if (outcomeType(result) === "unobserved_upstream_error") return true;
  return ["unobserved", "inconclusive"].includes(outcomeType(result) ?? "") || (result.raw_response?.score_included === false && !isConnectorDiagnostic(result));
}

function isObservedBehaviour(result: ResultRow) {
  return !isConnectorDiagnostic(result) && !isUnobserved(result);
}

function categoryCoverage(results: ResultRow[], category: string) {
  const selected = results.filter((result) => getTestCase(result)?.category === category && !isConnectorDiagnostic(result));
  return {
    observed: selected.filter(isObservedBehaviour).length,
    total: selected.length,
  };
}

function ScoreBar({
  label,
  value,
  observed,
  total,
  minimum,
}: {
  label: string;
  value: number | null;
  observed: number;
  total: number;
  minimum?: number;
}) {
  const sufficient = minimum === undefined || observed >= minimum;
  const score = value === null ? null : Math.max(0, Math.min(100, Number(value)));

  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-4 text-sm">
        <div>
          <span className="font-semibold text-white">{label}</span>
          <p className="mt-1 text-xs text-[var(--muted)]">{observed}/{total} observed{minimum === undefined ? " · legacy policy" : ` · minimum ${minimum}`}</p>
        </div>
        {sufficient && score !== null ? (
          <span className="font-black tabular-nums text-white">{score.toFixed(0)}</span>
        ) : (
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-black text-amber-200">Insufficient evidence</span>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${sufficient && score !== null ? score : 0}%` }} />
      </div>
    </div>
  );
}

export default async function AgentScorecardPage({ params }: PageProps) {
  const { slug } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) throw new Error("Missing server database configuration");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: agent } = await supabase
    .from("public_agents")
    .select("id,name,slug,description,category,created_at")
    .eq("slug", slug)
    .single();

  if (!agent) notFound();

  const { data: historyData } = await supabase
    .from("public_benchmark_runs")
    .select("id,status,production_score,task_success_score,reliability_score,safety_score,error_handling_score,efficiency_score,avg_latency_ms,completed_at,created_at,suite_version,scoring_policy_version,readiness_status,readiness_reasons,coverage")
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
      .from("public_benchmark_results")
      .select("id,passed,score,latency_ms,judge_reason,raw_response,test_cases")
      .eq("benchmark_run_id", run.id)
      .order("created_at", { ascending: true });

    results = (data ?? []) as ResultRow[];
  }

  const observedResults = results.filter(isObservedBehaviour);
  const unobservedResults = results.filter(isUnobserved);
  const diagnosticResults = results.filter(isConnectorDiagnostic);
  const passedCount = observedResults.filter((result) => result.passed).length;
  const failedCount = observedResults.length - passedCount;
  const diagnosticPassedCount = diagnosticResults.filter((result) => result.passed).length;
  const taskCoverage = run?.coverage?.task_success ?? categoryCoverage(results, "task_success");
  const reliabilityCoverage = run?.coverage?.reliability ?? categoryCoverage(results, "reliability");
  const safetyCoverage = run?.coverage?.safety ?? categoryCoverage(results, "safety");
  const positiveReadiness=run?.readiness_status === "meets_benchmark_gates";
  const productionScore = run?.production_score == null ? null : Number(run.production_score);
  const previousScore = previousRun?.production_score == null ? null : Number(previousRun.production_score);
  const scoreDelta = comparableRuns(run, previousRun) && productionScore !== null && previousScore !== null ? productionScore - previousScore : null;
  const insufficientCategories = run?.readiness_reasons ?? ["Evidence was not sufficient under this run's recorded policy."];
  const aiResults = results
    .map((result) => ({
      result,
      testCase: getTestCase(result),
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
                <p className="mt-1 font-bold text-white">{formatDate(run.completed_at)}</p><p className="mt-1 text-xs">Suite {run.suite_version ?? "legacy-unknown"} · {run.scoring_policy_version ?? "legacy-unversioned"}</p>
              </div>
            ) : null}
            <RerunBenchmarkButton slug={agent.slug} />
          </div>
        </div>

        {!run ? (
          <BenchmarkPending />
        ) : (
          <>
            <div className={`mt-10 flex flex-col gap-4 rounded-3xl p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${!positiveReadiness ? "border border-amber-500/20 bg-amber-500/10" : "border border-emerald-500/20 bg-emerald-500/10"}`}>
              <div className="flex items-start gap-3">
                {!positiveReadiness ? <CircleGauge className="mt-0.5 shrink-0 text-amber-300" size={21} /> : <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={21} />}
                <div>
                  <p className={`font-black ${!positiveReadiness ? "text-amber-50" : "text-emerald-50"}`}>{productionScore === null ? "Benchmark complete — score withheld" : readinessLabel(run, productionScore)}</p>
                  <p className={`mt-1 text-sm leading-6 ${!positiveReadiness ? "text-amber-100/70" : "text-emerald-100/70"}`}>{productionScore === null ? `Insufficient behavioural coverage: ${insufficientCategories.join("; ")}.` : readinessLabel(run, productionScore)}</p>
                </div>
              </div>
              <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] ${!positiveReadiness ? "text-amber-100/80" : "text-emerald-100/80"}`}><ShieldCheck size={14} /> {productionScore === null ? "Insufficient evidence" : readinessLabel(run, productionScore)}</div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="relative overflow-hidden rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-8 sm:p-10">
                <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-[var(--accent)]/8 blur-3xl" />
                <div className="relative">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]"><CircleGauge size={16} /> Recorded benchmark result</div>
                  {productionScore === null ? (
                    <>
                      <p className="mt-7 text-4xl font-black tracking-[-0.045em] text-white sm:text-5xl">Score withheld</p>
                      <span className="mt-5 inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-sm font-black text-amber-200">Insufficient evidence</span>
                      <p className="mt-4 max-w-md text-sm leading-6 text-[var(--muted)]">BENCHRX did not observe enough behaviour in every critical category to issue a defensible production-readiness score.</p>
                    </>
                  ) : (
                    <>
                      <div className="mt-7 flex items-end gap-3">
                        <span className="text-8xl font-black leading-none tracking-[-0.07em] text-white sm:text-9xl">{productionScore.toFixed(0)}</span>
                        <span className="mb-3 text-xl font-bold text-[var(--muted)]">/100</span>
                      </div>
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <span className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 py-1.5 text-sm font-black text-[var(--accent)]">{readinessLabel(run, productionScore)}</span>
                        {scoreDelta !== null ? (
                          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-black ${scoreDelta > 0 ? "bg-emerald-500/10 text-emerald-200" : scoreDelta < 0 ? "bg-red-500/10 text-red-200" : "bg-white/5 text-[var(--muted)]"}`}>
                            {scoreDelta > 0 ? <TrendingUp size={15} /> : scoreDelta < 0 ? <TrendingDown size={15} /> : null}
                            {scoreDelta > 0 ? "+" : ""}{scoreDelta.toFixed(0)} vs previous
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-4 max-w-md text-sm leading-6 text-[var(--muted)]">{positiveReadiness ? scoreSummary(productionScore) : "This numerical result does not establish production readiness. Review the recorded policy and gate findings."}</p>
                    </>
                  )}
                  <div className="mt-8 grid grid-cols-2 gap-3 border-t border-white/8 pt-6 sm:grid-cols-4">
                    <div><p className="text-xs text-[var(--muted)]">Attempted</p><p className="mt-1 text-xl font-black text-white">{results.length}</p></div>
                    <div><p className="text-xs text-[var(--muted)]">Observed</p><p className="mt-1 text-xl font-black text-white">{observedResults.length}</p></div>
                    <div><p className="text-xs text-[var(--muted)]">Unobserved</p><p className={`mt-1 text-xl font-black ${unobservedResults.length > 0 ? "text-amber-300" : "text-white"}`}>{unobservedResults.length}</p></div>
                    <div><p className="text-xs text-[var(--muted)]">Diagnostics</p><p className="mt-1 text-xl font-black text-white">{diagnosticResults.length}</p></div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
                    <span>{passedCount} observed passes</span>
                    <span>{failedCount} observed failures</span>
                    <span>{Number(run.avg_latency_ms ?? 0).toLocaleString()} ms avg observed latency</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-8 sm:p-10">
                <div className="flex items-center justify-between gap-4">
                  <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Score breakdown</p><h2 className="mt-2 text-2xl font-black">Blind resilience</h2></div>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-200">Active</span>
                </div>
                <div className="mt-7 space-y-6">
                  <ScoreBar label="Task success" value={run.task_success_score} observed={taskCoverage.observed} total={taskCoverage.total} minimum={run.coverage?.task_success?.minimum} />
                  <ScoreBar label="Reliability" value={run.reliability_score} observed={reliabilityCoverage.observed} total={reliabilityCoverage.total} minimum={run.coverage?.reliability?.minimum} />
                  <ScoreBar label="Safety" value={run.safety_score} observed={safetyCoverage.observed} total={safetyCoverage.total} minimum={run.coverage?.safety?.minimum} />
                  {diagnosticResults.length > 0 ? (
                    <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-white">Connector diagnostics</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Connector contract checks. Excluded under the current scoring policy; legacy runs retain their recorded policy.</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-black text-[var(--muted)]">{diagnosticPassedCount}/{diagnosticResults.length} passed</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-4 text-sm"><span className="font-semibold text-white">Error handling</span><span className="font-black tabular-nums text-white">{Number(run.error_handling_score ?? 0).toFixed(0)}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(100, Number(run.error_handling_score ?? 0)))}%` }} /></div>
                    </div>
                  )}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm"><span className="font-semibold text-white">Efficiency</span><span className="font-black tabular-nums text-white">{run.efficiency_score === null ? "Unobserved" : Number(run.efficiency_score).toFixed(0)}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(100, Number(run.efficiency_score ?? 0)))}%` }} /></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-6">
                <div className="flex items-center justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"><Eye size={19} /></div><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-200">Active</span></div>
                <h3 className="mt-5 text-lg font-black">Blind resilience</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Universal scored checks for task handling, reliability, safety and ambiguity. Connector diagnostics are reported separately.</p>
              </div>
              <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-6">
                <div className="flex items-center justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white"><Target size={19} /></div><span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">Planned</span></div>
                <h3 className="mt-5 text-lg font-black">Declared purpose</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Tests whether the agent actually performs the job and limits its developer declares.</p>
              </div>
              <div className="rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-6">
                <div className="flex items-center justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"><Sparkles size={19} /></div><span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-200">Shadow</span></div>
                <h3 className="mt-5 text-lg font-black">AI evaluation</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Shadow judgments are retained privately for calibration and do not affect this score.</p>
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
                <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Evidence</p><h2 className="mt-3 text-3xl font-black tracking-[-0.035em]">Blind resilience evidence</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Observed behaviour, unobserved upstream outcomes and connector diagnostics from the latest completed run are shown separately.</p></div>
                <p className="text-sm text-[var(--muted)]">Run {run.id.slice(0, 8)}</p>
              </div>
              <div className="mt-6 overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)]">
                {results.map((result, index) => {
                  const testCase = getTestCase(result);
                  const diagnostic = isConnectorDiagnostic(result);
                  const unobserved = isUnobserved(result);
                  return (
                    <div key={result.id} className={`flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7 ${index !== results.length - 1 ? "border-b border-white/8" : ""}`}>
                      <div className="flex min-w-0 items-start gap-4">
                        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${diagnostic ? "border-white/10 bg-white/5 text-[var(--muted)]" : unobserved ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : result.passed ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-red-500/20 bg-red-500/10 text-red-300"}`}>{diagnostic || unobserved ? <CircleGauge size={18} /> : result.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}</div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-white">{testCase?.title ?? "BENCHRX test"}</p>
                            {diagnostic ? (
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">Connector diagnostic</span>
                            ) : unobserved ? (
                              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-200">Unobserved</span>
                            ) : (
                              <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${result.passed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"}`}>{result.passed ? "Passed" : "Failed"}</span>
                            )}
                            <span className="rounded-full border border-[var(--accent)]/15 bg-[var(--accent)]/8 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--accent)]">Blind</span>
                            {result.raw_response?.ai_judge ? <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-200">AI judged</span> : null}
                            {testCase?.category ? <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{prettyCategory(testCase.category)}</span> : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{result.judge_reason ?? testCase?.description ?? "Benchmark check completed."}</p>
                          {diagnostic ? <p className="mt-1 text-xs font-semibold text-[var(--muted)]">This result describes the BENCHRX-managed connector contract and is not included in the agent production score.</p> : null}
                          {unobserved ? <p className="mt-1 text-xs font-semibold text-amber-200/80">BENCHRX did not receive observable agent behaviour, so this result is not treated as a behavioural failure.</p> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-6 pl-13 text-sm sm:pl-0">
                        <div className="text-right"><p className="text-xs text-[var(--muted)]">Latency</p><p className="mt-1 font-bold tabular-nums text-white">{Number(result.latency_ms ?? 0).toLocaleString()} ms</p></div>
                        <div className="min-w-16 text-right"><p className="text-xs text-[var(--muted)]">{diagnostic || unobserved ? "Scoring" : "Score"}</p><p className="mt-1 font-black tabular-nums text-white">{diagnostic || unobserved ? "Not scored" : Number(result.score ?? 0).toFixed(0)}</p></div>
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
                  const score = item.production_score === null ? null : Number(item.production_score);
                  const next = history[index + 1];
                  const nextScore = next?.production_score === null || next?.production_score === undefined ? null : Number(next.production_score);
                  const delta = comparableRuns(item, next) && score !== null && nextScore !== null ? score - nextScore : null;
                  return (
                    <div key={item.id} className={`flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${index !== history.length - 1 ? "border-b border-white/8" : ""}`}>
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-full ${index === 0 ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "bg-white/5 text-[var(--muted)]"}`}><Clock3 size={17} /></div>
                        <div><p className="font-black text-white">{index === 0 ? "Latest run" : `Previous run ${index}`}</p><p className="mt-1 text-xs text-[var(--muted)]">{formatDate(item.completed_at)} · Suite {item.suite_version ?? "legacy-unknown"} · {item.scoring_policy_version ?? "legacy-unversioned"}{next && !comparableRuns(item, next) ? " · Not comparable with previous run" : ""}</p></div>
                      </div>
                      <div className="flex items-center gap-5 pl-12 sm:pl-0">
                        {delta !== null ? <span className={`text-sm font-black ${delta > 0 ? "text-emerald-300" : delta < 0 ? "text-red-300" : "text-[var(--muted)]"}`}>{delta > 0 ? "+" : ""}{delta.toFixed(0)}</span> : null}
                        <div className="text-right"><p className="text-xs text-[var(--muted)]">Score</p><p className={`mt-1 font-black tabular-nums ${score === null ? "text-sm text-amber-200" : "text-2xl text-white"}`}>{score === null ? "Withheld" : score.toFixed(0)}</p></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-4 rounded-3xl border border-white/8 bg-white/[0.025] p-6 text-sm leading-6 text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-3xl">This result reflects BENCHRX blind resilience checks only. Unobserved upstream outcomes, BENCHRX-managed connector diagnostics and AI shadow judgments are displayed for transparency but are not scored as observed agent behaviour.</p>
              <Link href="/benchmark" className="shrink-0 rounded-full border border-white/12 px-5 py-2.5 font-bold text-white transition hover:border-[var(--accent)]/60">Benchmark another agent</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}