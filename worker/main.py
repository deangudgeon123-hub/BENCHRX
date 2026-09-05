from __future__ import annotations

from typing import Any

from fastapi import BackgroundTasks, FastAPI

from benchmarks.runner import execute_run
from benchmarks.tests import BENCHMARK_SUITE_VERSION
from config import OPENAI_JUDGE_MODEL
from models.payloads import TriggerPayload

app = FastAPI(title="BENCHRX Worker", version="0.6.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "version": "0.6.0",
        "benchmark_suite": BENCHMARK_SUITE_VERSION,
        "ai_judge": "shadow",
        "ai_model": OPENAI_JUDGE_MODEL,
    }


@app.post("/trigger")
async def trigger(
    payload: TriggerPayload, background_tasks: BackgroundTasks
) -> dict[str, str]:
    background_tasks.add_task(execute_run, payload.run_id)
    return {"status": "accepted", "run_id": payload.run_id}


@app.post("/run-next")
async def run_next(payload: TriggerPayload) -> dict[str, Any]:
    return await execute_run(payload.run_id)
