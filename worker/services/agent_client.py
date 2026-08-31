from __future__ import annotations

import time
from typing import Any

import httpx


def extract_response(payload: Any) -> str:
    if isinstance(payload, dict):
        value = payload.get("response")
        return value.strip() if isinstance(value, str) else ""
    return ""


def response_payload(response: httpx.Response) -> dict[str, Any]:
    try:
        body: Any = response.json()
    except ValueError:
        body = {"text": response.text}

    return {"http_status": response.status_code, "body": body}


async def send_request(
    client: httpx.AsyncClient,
    endpoint_url: str,
    payload: dict[str, Any],
) -> tuple[httpx.Response | None, int, str | None]:
    started = time.perf_counter()
    try:
        response = await client.post(endpoint_url, json=payload)
        return response, int((time.perf_counter() - started) * 1000), None
    except Exception as exc:
        return None, int((time.perf_counter() - started) * 1000), str(exc)
