from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException

from benchmarks.evaluator import run_test
from benchmarks.scoring import category_score
from benchmarks.tests import BENCHMARK_SUITE_VERSION, TESTS
from config import AI_JUDGE_TEST_KEYS, OPENAI_JUDGE_MODEL
from judges.openai_judge import judge_with_openai
from services.supabase import ensure_test_cases, get_supabase


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uses_benchrx_adapter(endpoint_url: str) -> bool:
    return "/api/adapters/" in endpoint_url


async def execute_run(run_id: str) -> dict[str, Any]:
    supabase = get_supabase()

    run_result = (
        supabase.table("benchmark_runs")
        .select("id,agent_id,status,created_at")
        .eq("id", run_id)
        .single()
        .execute()
    )
    run = run_result.data

    if not run:
        raise RuntimeError("Benchmark run not found")

    if run["status"] == "completed":
        return {"status": "completed", "run_id": run_id}

    if run["status"] not in {"queued", "running"}:
        return {"status": run["status"], "run_id": run_id}

    agent_id = run["agent_id"]
    supabase.table("benchmark_runs").update({"status": "running", "started_at": utc_now_iso()}).eq("id", run_id).execute()

    try:
        agent_result = (
            supabase.table("agents")
            .select("id,name,description,category,endpoint_url")
            .eq("id", agent_id)
            .single()
            .execute()
        )
        agent = agent_result.data
        if not agent:
            raise RuntimeError("Agent not found")

        endpoint_url = agent["endpoint_url"]
        adapter_mediated = uses_benchrx_adapter(endpoint_url)
        test_case_ids = ensure_test_cases(supabase)
        results: list[dict[str, Any]] = []

        async with httpx.AsyncClient(timeout=20.0) as client:
            for test in TESTS:
                outcome = await run_test(client, endpoint_url, test)
                connector_diagnostic = adapter_mediated and test["category"] == "error_handling"

                ai_judge: dict[str, Any] | None = None
                if test["key"] in AI_JUDGE_TEST_KEYS:
                    ai_judge = await judge_with_openai(
                        test,
                        outcome,
                        agent.get("description"),
                        agent.get("category"),
                    )

                raw_response = outcome["raw_response"]
                if isinstance(raw_response, dict):
                    raw_response = {
                        **raw_response,
                        "benchrx_suite_version": BENCHMARK_SUITE_VERSION,
                    }
                    if ai_judge is not None:
                        raw_response = {**raw_response, "ai_judge": ai_judge}
                    if connector_diagnostic:
                        raw_response = {
                            **raw_response,
                            "benchrx_diagnostic": True,
                            "score_included": False,
                        }

                item = {
                    "key": test["key"],
                    "category": test["category"],
                    "title": test["title"],
                    "weight": test["weight"],
                    "connector_diagnostic": connector_diagnostic,
                    **outcome,
                }
                results.append(item)
                supabase.table("benchmark_results").insert(
                    {
                        "benchmark_run_id": run_id,
                        "test_case_id": test_case_ids[test["key"]],
                        "passed": outcome["passed"],
                        "score": outcome["score"],
                        "latency_ms": outcome["latency_ms"],
                        "judge_reason": outcome["reason"],
                        "raw_response": raw_response,
                    }
                ).execute()

        task_success = category_score(results, "task_success")
        reliability = category_score(results, "reliability")
        safety = category_score(results, "safety")
        error_handling = category_score(results, "error_handling")

        if adapter_mediated:
            production_score = round(
                (task_success * 0.40 + safety * 0.25 + reliability * 0.20) / 0.85,
                2,
            )
            scored_results = [item for item in results if not item["connector_diagnostic"]]
        else:
            production_score = round(
                task_success * 0.40
                + safety * 0.25
                + reliability * 0.20
                + error_handling * 0.15,
                2,
            )
            scored_results = results

        avg_latency_ms = round(
            sum(item["latency_ms"] for item in scored_results) / len(scored_results)
        )
        efficiency = 100 if avg_latency_ms <= 1000 else 75 if avg_latency_ms <= 2000 else 50 if avg_latency_ms <= 4000 else 25 if avg_latency_ms <= 8000 else 0

        supabase.table("benchmark_runs").update(
            {
                "status": "completed",
                "production_score": production_score,
                "task_success_score": task_success,
                "reliability_score": reliability,
                "safety_score": safety,
                "error_handling_score": error_handling,
                "efficiency_score": efficiency,
                "avg_latency_ms": avg_latency_ms,
                "completed_at": utc_now_iso(),
            }
        ).eq("id", run_id).execute()

        return {
            "status": "completed",
            "run_id": run_id,
            "agent_id": agent_id,
            "production_score": production_score,
            "benchmark_suite_version": BENCHMARK_SUITE_VERSION,
            "scored_checks": len(scored_results),
            "ai_judge_model": OPENAI_JUDGE_MODEL,
            "ai_judge_mode": "shadow",
        }
    except Exception as exc:
        supabase.table("benchmark_runs").update({"status": "failed", "completed_at": utc_now_iso()}).eq("id", run_id).execute()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
