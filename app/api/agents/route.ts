import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function makeSlug(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "agent"}-${suffix}`;
}

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

function buildCustomEndpoint(request: Request, body: Record<string, unknown>) {
  const targetUrl = String(body.targetUrl ?? "").trim();
  const requestPath = String(body.requestPath ?? "message").trim() || "message";
  const responsePath = String(body.responsePath ?? "response").trim() || "response";
  const fixedBody = String(body.fixedBody ?? "{}").trim() || "{}";

  if (!targetUrl) {
    throw new Error("Custom target URL is required.");
  }

  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    throw new Error("Enter a valid custom target URL.");
  }

  if (target.protocol !== "https:") {
    throw new Error("Custom agent endpoints must use HTTPS.");
  }

  try {
    const parsed = JSON.parse(fixedBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
  } catch {
    throw new Error("Fixed request JSON must be a valid JSON object.");
  }

  const endpoint = new URL("/api/adapters/generic", new URL(request.url).origin);
  endpoint.searchParams.set("target", target.toString());
  endpoint.searchParams.set("requestPath", requestPath);
  endpoint.searchParams.set("responsePath", responsePath);
  endpoint.searchParams.set("fixedBody", fixedBody);
  return endpoint.toString();
}

function buildGradioEndpoint(request: Request, body: Record<string, unknown>) {
  const spaceUrl = String(body.spaceUrl ?? "").trim();
  const apiName = String(body.apiName ?? "chat").trim() || "chat";
  const gradioInputs = String(body.gradioInputs ?? "[]").trim() || "[]";
  const outputIndex = String(body.outputIndex ?? "0").trim() || "0";

  if (!spaceUrl) {
    throw new Error("Gradio Space URL is required.");
  }

  let parsedSpace: URL;
  try {
    parsedSpace = new URL(spaceUrl);
  } catch {
    throw new Error("Enter a valid Gradio Space URL.");
  }

  if (parsedSpace.protocol !== "https:") {
    throw new Error("Gradio Space endpoints must use HTTPS.");
  }

  try {
    const parsedInputs = JSON.parse(gradioInputs);
    if (!Array.isArray(parsedInputs)) throw new Error();
  } catch {
    throw new Error("Gradio input JSON must be a valid JSON array.");
  }

  const parsedOutputIndex = Number(outputIndex);
  if (!Number.isInteger(parsedOutputIndex) || parsedOutputIndex < 0) {
    throw new Error("Gradio output index must be a non-negative integer.");
  }

  const endpoint = new URL("/api/adapters/gradio", new URL(request.url).origin);
  endpoint.searchParams.set("space", parsedSpace.origin);
  endpoint.searchParams.set("apiName", apiName);
  endpoint.searchParams.set("inputs", gradioInputs);
  endpoint.searchParams.set("outputIndex", outputIndex);
  return endpoint.toString();
}

export async function GET() {
  const supabase = getServerSupabase();

  if (!supabase) {
    return NextResponse.json({ error: "Server configuration is incomplete." }, { status: 500 });
  }

  const { data: agents, error } = await supabase
    .from("agents")
    .select("id,name,slug,category,created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    console.error("Recent agents query failed", error);
    return NextResponse.json({ error: "Could not load recent benchmarks." }, { status: 500 });
  }

  const recent = await Promise.all(
    (agents ?? []).map(async (agent) => {
      const { data: runs } = await supabase
        .from("benchmark_runs")
        .select("status,production_score,created_at,completed_at")
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const run = runs?.[0] ?? null;

      return {
        name: agent.name,
        slug: agent.slug,
        category: agent.category,
        createdAt: agent.created_at,
        status: run?.status ?? "queued",
        score: run?.production_score ?? null,
      };
    })
  );

  return NextResponse.json({ recent });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "general").trim().toLowerCase();
    const description = String(body.description ?? "").trim();
    const connectionType = String(body.connectionType ?? "native").trim().toLowerCase();

    let endpointUrl = String(body.endpointUrl ?? "").trim();
    if (connectionType === "custom") {
      try {
        endpointUrl = buildCustomEndpoint(request, body);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid custom connection." },
          { status: 400 }
        );
      }
    } else if (connectionType === "gradio") {
      try {
        endpointUrl = buildGradioEndpoint(request, body);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid Gradio connection." },
          { status: 400 }
        );
      }
    }

    if (!name || !endpointUrl) {
      return NextResponse.json(
        { error: "Agent name and endpoint URL are required." },
        { status: 400 }
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(endpointUrl);
    } catch {
      return NextResponse.json({ error: "Enter a valid agent endpoint URL." }, { status: 400 });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: "Agent endpoint must use HTTP or HTTPS." }, { status: 400 });
    }

    const supabase = getServerSupabase();

    if (!supabase) {
      console.error("Missing Supabase server environment variables");
      return NextResponse.json({ error: "Server configuration is incomplete." }, { status: 500 });
    }

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .insert({
        name,
        slug: makeSlug(name),
        description: description || null,
        category: category || "general",
        endpoint_url: parsedUrl.toString(),
        is_public: true,
      })
      .select("id,name,slug,category,endpoint_url,workspace_id,created_at")
      .single();

    if (agentError || !agent) {
      console.error("Supabase agent insert failed", agentError);
      return NextResponse.json({ error: "Could not save this agent." }, { status: 500 });
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
      console.error("Supabase benchmark run insert failed", benchmarkError);
      await supabase.from("agents").delete().eq("id", agent.id);
      return NextResponse.json(
        { error: "Agent was not saved because its benchmark run could not be queued." },
        { status: 500 }
      );
    }

    let benchmarkTriggered = false;
    try {
      await triggerBenchmarkWorker(benchmarkRun.id);
      benchmarkTriggered = true;
    } catch (error) {
      console.error("BENCHRX worker trigger failed", error);
    }

    return NextResponse.json(
      {
        agent,
        benchmarkRun,
        benchmarkTriggered,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Agent submission failed", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
