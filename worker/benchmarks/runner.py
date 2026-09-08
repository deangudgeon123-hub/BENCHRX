from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from benchmarks.evaluator import run_test
from benchmarks.scoring import category_score
from benchmarks.policy import assess, suite_manifest, SCORING_POLICY_VERSION, MINIMUM_BEHAVIOURAL_COVERAGE
from benchmarks.tests import BENCHMARK_SUITE_VERSION, TESTS
from config import AI_JUDGE_TEST_KEYS, OPENAI_JUDGE_MODEL
from judges.openai_judge import judge_with_openai
from services.public_network import public_client
from services.supabase import ensure_test_cases, get_supabase


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uses_benchrx_adapter(endpoint_url: str) -> bool:
    return urlparse(endpoint_url).path.rstrip("/") in {"/api/adapters/generic", "/api/adapters/gradio", "/api/adapters/storkie"}


def _outcome_observed(test: dict[str, Any], outcome: dict[str, Any]) -> bool:
    # Trust only request-operation metadata. Never inspect raw_response/body recursively.
    attempts = outcome.get("execution", {}).get("attempts", [])
    return bool(attempts) and any(a.get("response_observed") is True for a in attempts)


def _weighted_available_score(values: list[tuple[float | None, float]]) -> float:
    available = [(score, weight) for score, weight in values if score is not None]
    if not available:
        return 0.0
    total_weight = sum(weight for _, weight in available)
    return round(sum(float(score) * weight for score, weight in available) / total_weight, 2)


def _category_coverage(results: list[dict[str, Any]], category: str) -> dict[str, int]:
    category_results = [item for item in results if item["category"] == category]
    observed = [item for item in category_results if item.get("observed", True)]
    return {"observed": len(observed), "total": len(category_results)}


def _behavioural_coverage_sufficient(coverage: dict[str, dict[str, int]]) -> bool:
    return all(
        coverage[category]["observed"] >= minimum
        for category, minimum in MINIMUM_BEHAVIOURAL_COVERAGE.items()
    )


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

        async with public_client() as client:
            for test in TESTS:
                outcome = await run_test(client, endpoint_url, test)
                connector_diagnostic = test["category"] == "error_handling"
                observed = _outcome_observed(test, outcome)

                ai_judge: dict[str, Any] | None = None
                if observed and test["key"] in AI_JUDGE_TEST_KEYS:
                    ai_judge = await judge_with_openai(
                        test,
                        outcome,
                        agent.get("description"),
                        agent.get("category"),
                    )

                raw_response = outcome["raw_response"]
                if isinstance(raw_response, dict):
                    if connector_diagnostic:
                        outcome_type = "connector_diagnostic"
                    elif not observed:
                        outcome_type = "unobserved"
                    elif outcome["passed"] is None:
                        outcome_type = "inconclusive"
                    elif outcome["passed"]:
                        outcome_type = "agent_pass"
                    else:
                        outcome_type = "agent_fail"

                    raw_response = {
                        **raw_response,
                        "benchrx_suite_version": BENCHMARK_SUITE_VERSION,
                        "execution": outcome["execution"],
                        "evidence_complete": outcome["evidence_complete"],
                        "outcome_type": outcome_type,
                        "observed": observed,
                    }
                    if ai_judge is not None:
                        raw_response = {**raw_response, "ai_judge": ai_judge}
                    if connector_diagnostic:
                        raw_response = {
                            **raw_response,
                            "benchrx_diagnostic": True,
                            "score_included": False,
                        }
                    elif not observed:
                        raw_response = {
                            **raw_response,
                            "score_included": False,
                        }

                item = {
                    "key": test["key"],
                    "category": test["category"],
                    "title": test["title"],
                    "weight": test["weight"],
                    "connector_diagnostic": connector_diagnostic,
                    "observed": observed,
                    **outcome,
                }
                results.append(item)
                supabase.table("benchmark_results").insert(
                    {
                        "benchmark_run_id": run_id,
                        "test_key": test["key"],
                        "test_snapshot": test,
                        "execution_metadata": outcome["execution"],
                        "observed": observed,
                        "evidence_complete": outcome["evidence_complete"],
                        "outcome_type": outcome_type,
                        "score_included": not connector_diagnostic and outcome["score"] is not None,
                        "test_case_id": test_case_ids[test["key"]],
                        "passed": outcome["passed"],
                        "score": outcome["score"],
                        "latency_ms": outcome["latency_ms"],
                        "judge_reason": outcome["reason"],
                        "raw_response": raw_response,
                    }
                ).execute()

        decision = assess(results)
        production_score = decision['production_score']
        coverage = decision['coverage']
        coverage_sufficient = decision['coverage_sufficient']
        task_success = decision['task_success_score']
        reliability = decision['reliability_score']
        safety = decision['safety_score']
        diagnostics = [r for r in results if r['connector_diagnostic'] and r['score'] is not None]
        error_handling = round(sum(r['score']*r['weight'] for r in diagnostics)/sum(r['weight'] for r in diagnostics),2) if diagnostics else None
        scored_results = [r for r in results if not r['connector_diagnostic'] and r.get('observed') and r['score'] is not None]

        avg_latency_ms = (
            round(sum(item["latency_ms"] for item in scored_results) / len(scored_results))
            if scored_results
            else None
        )
        efficiency = None if avg_latency_ms is None else 100 if avg_latency_ms <= 1000 else 75 if avg_latency_ms <= 2000 else 50 if avg_latency_ms <= 4000 else 25 if avg_latency_ms <= 8000 else 0

        supabase.table("benchmark_runs").update(
            {
                "status": "completed",
                "suite_version": BENCHMARK_SUITE_VERSION,
                "scoring_policy_version": SCORING_POLICY_VERSION,
                "suite_manifest": suite_manifest(),
                **{k: decision[k] for k in ("coverage", "readiness_status", "readiness_reasons", "critical_failures", "missing_critical_tests")},
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

        unobserved_checks = len(
            [
                item
                for item in results
                if not item["connector_diagnostic"] and not item.get("observed", True)
            ]
        )
        connector_diagnostics = len([item for item in results if item["connector_diagnostic"]])

        return {
            "status": "completed",
            "run_id": run_id,
            "agent_id": agent_id,
            "production_score": production_score,
            "production_score_withheld": not coverage_sufficient,
            "benchmark_suite_version": BENCHMARK_SUITE_VERSION,
            "tests_attempted": len(results),
            "scored_checks": len(scored_results),
            "unobserved_checks": unobserved_checks,
            "connector_diagnostics": connector_diagnostics,
            "coverage": coverage,
            "minimum_coverage": MINIMUM_BEHAVIOURAL_COVERAGE,
            "ai_judge_model": OPENAI_JUDGE_MODEL,
            "ai_judge_mode": "shadow",
        }
    except Exception as exc:
        supabase.table("benchmark_runs").update({"status": "failed", "completed_at": utc_now_iso()}).eq("id", run_id).execute()
        raise HTTPException(status_code=500, detail=str(exc)) from exc