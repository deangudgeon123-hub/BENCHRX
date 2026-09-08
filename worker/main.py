from __future__ import annotations

from typing import Any
import asyncio
import contextlib
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from services.supabase import get_supabase

from fastapi import BackgroundTasks, FastAPI, Depends

from benchmarks.runner import execute_run
from benchmarks.tests import BENCHMARK_SUITE_VERSION
from config import OPENAI_JUDGE_MODEL
from models.payloads import TriggerPayload
from services.worker_auth import require_worker_auth

async def dispatch_loop():
    # Persisted queued/expired work survives failed HTTP triggers and worker restarts.
    while True:
        try:
            supabase = get_supabase()
            now = datetime.now(timezone.utc).isoformat()
            data = await asyncio.to_thread(lambda: supabase.table("benchmark_runs").select("id").or_(f"status.eq.queued,and(status.eq.running,lease_expires_at.lt.{now})").order("created_at").limit(2).execute())
            await asyncio.gather(*(execute_run(row["id"]) for row in data.data), return_exceptions=True)
        except Exception:
            pass # No raw connection/database errors in public logs.
        await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app):
    task = None
    if os.getenv("BENCHRX_POLL_QUEUE") == "1" and len(os.getenv("BENCHMARK_API_SECRET", "")) >= 32:
        task = asyncio.create_task(dispatch_loop())
    yield
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError): await task


app = FastAPI(title="BENCHRX Worker", version="0.7.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "version": "0.6.0",
        "benchmark_suite": BENCHMARK_SUITE_VERSION,
        "ai_judge": "shadow",
        "ai_model": OPENAI_JUDGE_MODEL,
    }


@app.post("/trigger", dependencies=[Depends(require_worker_auth)])
async def trigger(
    payload: TriggerPayload, background_tasks: BackgroundTasks
) -> dict[str, str]:
    background_tasks.add_task(execute_run, str(payload.run_id))
    return {"status": "accepted", "run_id": str(payload.run_id)}


@app.post("/run-next", dependencies=[Depends(require_worker_auth)])
async def run_next(payload: TriggerPayload) -> dict[str, Any]:
    return await execute_run(str(payload.run_id))
