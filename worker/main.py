from __future__ import annotations

import os
import time
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from supabase import Client, create_client

load_dotenv()

app = FastAPI(title="BENCHRX Worker", version="0.1.0")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

    return create_client(url, key)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/run-next")
async def run_next() -> dict:
    supabase = get_supabase()

    queued = (
        supabase.table("benchmark_runs")
        .select("id,agent_id,status,created_at")
        .eq("status", "queued")
        .order("created_at")
        .limit(1)
        .execute()
    )

    if not queued.data:
        return {"status": "idle", "message": "No queued benchmark runs."}

    run = queued.data[0]
    run_id = run["id"]
    agent_id = run["agent_id"]

    supabase.table("benchmark_runs").update(
        {"status": "running", "started_at": utc_now_iso()}
    ).eq("id", run_id).execute()

    try:
        agent_result = (
            supabase.table("agents")
            .select("id,name,endpoint_url")
            .eq("id", agent_id)
            .single()
            .execute()
        )
        agent = agent_result.data

        if not agent:
            raise RuntimeError("Agent not found")

        started = time.perf_counter()
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                agent["endpoint_url"],
                json={"message": "Reply with a short acknowledgement that you received this BENCHRX test."},
            )
        latency_ms = int((time.perf_counter() - started) * 1000)

        raw_response: dict
        try:
            raw_response = response.json()
        except ValueError:
            raw_response = {"text": response.text}

        passed = 200 <= response.status_code < 300

        supabase.table("benchmark_results").insert(
            {
                "benchmark_run_id": run_id,
                "passed": passed,
                "score": 100 if passed else 0,
                "latency_ms": latency_ms,
                "judge_reason": f"HTTP {response.status_code}",
                "raw_response": raw_response,
            }
        ).execute()

        supabase.table("benchmark_runs").update(
            {
                "status": "completed" if passed else "failed",
                "production_score": 100 if passed else 0,
                "task_success_score": 100 if passed else 0,
                "avg_latency_ms": latency_ms,
                "completed_at": utc_now_iso(),
            }
        ).eq("id", run_id).execute()

        return {
            "status": "completed" if passed else "failed",
            "run_id": run_id,
            "agent_id": agent_id,
            "http_status": response.status_code,
            "latency_ms": latency_ms,
            "response": raw_response,
        }

    except Exception as exc:
        supabase.table("benchmark_runs").update(
            {"status": "failed", "completed_at": utc_now_iso()}
        ).eq("id", run_id).execute()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
