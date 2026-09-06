import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { Activity, ArrowRight, Clock3, FlaskConical, ShieldAlert } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

type AgentRow = {
  id: string;
  name: string;
  slug: string;
  category: string;
  endpoint_url: string | null;
};

type RunRow = {
  id: string;
  agent_id: string;
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

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getAgent(value: RunRow["agents"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function scoreTone(score: number | null) {
  const value = Number(score ?? 0);
  if (value >= 90) return "text-emerald-300";
  if (value >= 75) return "text-cyan-300";
  if (value >= 60) return "text-amber-300";
  return "text-red-300";
}

export default async function AdminRunsPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Missing Supabase public environment variables");

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("benchmark_runs")
    .select("id,agent_id,status,production_score,task_success_score,reliability_score,safety_score,efficiency_score,avg_latency_ms,created_at,completed_at,agents(id,name,slug,category,endpoint_url)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Unable to load admin runs: ${error.message}`);
  const runs = (data ?? []) as RunRow[];
  const completed = runs.filter((run) => run.status === "completed");
  const flagged = completed.filter((run) => Number(run.production_score ?? 0) < 60).length;
  const avgScore = completed.length
    ? Math.round(completed.reduce((sum, run) => sum + Number(run.production_score ?? 0), 0) / completed.length)
    : 0;

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <div className="flex flex-col gap-6 border-b border-white/8 pb-9 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">
              <FlaskConical size={15} /> Internal diagnostics
            </div>
            <h1 className="mt-4 text-4xl font-black tracking-[-0.045em] sm:text-5xl">Benchmark admin</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Read-only view of recent benchmark runs and raw evaluator evidence. Keep this route preview-only until admin authentication is added.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-100/80">
            Auth not added yet — do not merge this route to public production.
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]"><Activity size={15} /> Recent runs</div>
            <p className="mt-4 text-4xl font-black">{runs.length}</p>
          </div>
          <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]"><FlaskConical size={15} /> Avg score</div>
            <p className="mt-4 text-4xl font-black">{avgScore}</p>
          </div>
          <div className="rounded-3xl border border-white/8 bg-[var(--surface)] p-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]"><ShieldAlert size={15} /> Under 60</div>
            <p className="mt-4 text-4xl font-black text-red-300">{flagged}</p>
          </div>
        </div>

        <div className="mt-8 overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)]">
          <div className="border-b border-white/8 px-5 py-4 sm:px-6">
            <h2 className="font-black">Recent benchmark runs</h2>
          </div>
          <div className="divide-y divide-white/8">
            {runs.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-[var(--muted)]">No benchmark runs found.</div>
            ) : runs.map((run) => {
              const agent = getAgent(run.agents);
              return (
                <Link
                  key={run.id}
                  href={`/admin/runs/${run.id}`}
                  className="grid gap-4 px-5 py-5 transition hover:bg-white/[0.025] sm:px-6 lg:grid-cols-[1.4fr_0.7fr_0.7fr_0.7fr_0.9fr_auto] lg:items-center"
                >
                  <div>
                    <p className="font-black text-white">{agent?.name ?? "Unknown agent"}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{agent?.category ?? "—"} · {run.id.slice(0, 8)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)]">Score</p>
                    <p className={`mt-1 text-xl font-black ${scoreTone(run.production_score)}`}>{run.production_score ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)]">Safety</p>
                    <p className="mt-1 font-black">{run.safety_score ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)]">Latency</p>
                    <p className="mt-1 font-black tabular-nums">{run.avg_latency_ms ? `${Number(run.avg_latency_ms).toLocaleString()} ms` : "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)]">Completed</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-bold"><Clock3 size={13} /> {formatDate(run.completed_at ?? run.created_at)}</p>
                  </div>
                  <div className="flex items-center justify-end text-[var(--accent)]"><ArrowRight size={18} /></div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
