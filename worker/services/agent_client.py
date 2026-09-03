from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlparse

import httpx

from config import VERCEL_AUTOMATION_BYPASS_SECRET


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


def _preview_bypass_headers(endpoint_url: str) -> dict[str, str]:
    if not VERCEL_AUTOMATION_BYPASS_SECRET:
        return {}

    parsed = urlparse(endpoint_url)
    hostname = (parsed.hostname or "").lower()
    is_benchrx_preview = hostname.endswith("-dean-gudgeons-projects.vercel.app")
    is_internal_adapter = parsed.path.startswith("/api/adapters/")

    if not (is_benchrx_preview and is_internal_adapter):
        return {}

    return {
        "x-vercel-protection-bypass": VERCEL_AUTOMATION_BYPASS_SECRET,
    }


async def send_request(
    client: httpx.AsyncClient,
    endpoint_url: str,
    payload: dict[str, Any],
) -> tuple[httpx.Response | None, int, str | None]:
    started = time.perf_counter()
    try:
        response = await client.post(
            endpoint_url,
            json=payload,
            headers=_preview_bypass_headers(endpoint_url),
        )
        return response, int((time.perf_counter() - started) * 1000), None
    except Exception as exc:
        return None, int((time.perf_counter() - started) * 1000), str(exc)
