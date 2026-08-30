import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function triggerBenchmarkWorker(runId: string) {
  const workerBaseUrl = (
    process.env.BENCHMARK_API_URL || "https://benchrx-worker.onrender.com"
  ).replace(/\/$/, "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (process.env.BENCHMARK_API_SECRET) {
    headers.Authorization = `Bearer ${process.env.BENCHMARK_API_SECRET}`;
  }

  const response = await fetch(`${workerBaseUrl}/trigger`, {
    method: "POST",
    headers,
    body: JSON.stringify({ run_id: runId }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`BENCHRX worker trigger failed with ${response.status}`);
  }
}

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const { slug } = await params;
    const supabase = getServerSupabase();

    if (!supabase) {
      return NextResponse.json({ error: "Server configuration is incomplete." }, { status: 500 });
    }

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,slug,workspace_id")
      .eq("slug", slug)
      .eq("is_public", true)
      .single();

    if (agentError || !agent) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    const { data: activeRuns } = await supabase
      .from("benchmark_runs")
      .select("id,status")
      .eq("agent_id", agent.id)
      .in("status", ["queued", "running"])
      .limit(1);

    if (activeRuns?.length) {
      return NextResponse.json(
        { error: "A benchmark is already running for this agent." },
        { status: 409 }
      );
    }

    const { data: latestRuns } = await supabase
      .from("benchmark_runs")
      .select("created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(1);

    const latestCreatedAt = latestRuns?.[0]?.created_at;
    if (latestCreatedAt) {
      const ageMs = Date.now() - new Date(latestCreatedAt).getTime();
      if (ageMs < 60_000) {
        return NextResponse.json(
          { error: "Please wait a minute before running this agent again." },
          { status: 429 }
        );
      }
    }

    const { data: benchmarkRun, error: benchmarkError } = await supabase
      .from("benchmark_runs")
      .insert({
        agent_id: agent.id,
        workspace_id: agent.workspace_id,
        status: "queued",
      })
      .select("id,status,created_at")
      .single();

    if (benchmarkError || !benchmarkRun) {
      console.error("BENCHRX rerun insert failed", benchmarkError);
      return NextResponse.json({ error: "Could not queue another benchmark." }, { status: 500 });
    }

    try {
      await triggerBenchmarkWorker(benchmarkRun.id);
    } catch (error) {
      console.error("BENCHRX rerun worker trigger failed", error);
      return NextResponse.json(
        { error: "The run was queued, but the worker could not be started." },
        { status: 502 }
      );
    }

    return NextResponse.json({ benchmarkRun }, { status: 201 });
  } catch (error) {
    console.error("BENCHRX rerun failed", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
