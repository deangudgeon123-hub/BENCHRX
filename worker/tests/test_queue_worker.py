import pytest

import queue_worker


@pytest.mark.asyncio
async def test_dedicated_worker_runs_persisted_dispatch_loop(monkeypatch):
    calls = []

    async def dispatch():
        calls.append("dispatch")

    monkeypatch.setattr(queue_worker, "dispatch_loop", dispatch)
    await queue_worker.serve()

    assert calls == ["dispatch"]
