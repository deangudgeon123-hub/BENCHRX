import os

import main


def test_queue_polling_defaults_on_with_valid_secret(monkeypatch):
    monkeypatch.delenv("BENCHRX_POLL_QUEUE", raising=False)
    monkeypatch.setenv("BENCHMARK_API_SECRET", "x" * 32)
    assert main.queue_polling_enabled() is True


def test_queue_polling_can_be_explicitly_disabled(monkeypatch):
    monkeypatch.setenv("BENCHRX_POLL_QUEUE", "0")
    monkeypatch.setenv("BENCHMARK_API_SECRET", "x" * 32)
    assert main.queue_polling_enabled() is False


def test_queue_polling_requires_worker_secret(monkeypatch):
    monkeypatch.delenv("BENCHRX_POLL_QUEUE", raising=False)
    monkeypatch.setenv("BENCHMARK_API_SECRET", "short")
    assert main.queue_polling_enabled() is False
