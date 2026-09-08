from __future__ import annotations

import time
import asyncio
import os
from typing import Any
from urllib.parse import urlparse

import httpx

from config import VERCEL_AUTOMATION_BYPASS_SECRET
from services.public_network import validate_endpoint


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
    origin = f"{parsed.scheme}://{parsed.netloc}".rstrip('/')
    trusted = {value.strip().rstrip('/') for value in os.getenv('BENCHRX_ADAPTER_ORIGINS','').split(',') if value.strip()}
    if origin not in trusted or parsed.path.rstrip('/') not in {'/api/adapters/generic','/api/adapters/gradio','/api/adapters/storkie'}:
        return {}

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
        validate_endpoint(endpoint_url)
        parsed = urlparse(endpoint_url)
        trusted = {x.strip().rstrip('/') for x in os.getenv('BENCHRX_ADAPTER_ORIGINS','').split(',') if x.strip()}
        headers = _preview_bypass_headers(endpoint_url)
        if f"{parsed.scheme}://{parsed.netloc}" in trusted and parsed.path.rstrip('/') in {'/api/adapters/generic','/api/adapters/gradio','/api/adapters/storkie'}:
            secret = os.getenv('BENCHRX_ADAPTER_SECRET','')
            if not secret: raise ValueError('Adapter service authentication is not configured')
            headers['Authorization'] = f'Bearer {secret}'
        async with asyncio.timeout(65):
            async with client.stream('POST',endpoint_url,json=payload,headers=headers,follow_redirects=False) as streamed:
                chunks=[]
                size=0
                async for chunk in streamed.aiter_bytes():
                    size+=len(chunk)
                    if size>1_000_000: raise ValueError('response_size_limit')
                    chunks.append(chunk)
                response=httpx.Response(streamed.status_code,headers={'content-type':streamed.headers.get('content-type','')},content=b''.join(chunks))
        return response, int((time.perf_counter()-started)*1000), None
    except Exception as exc:
        # Never expose exception strings that may include URLs, credentials or remote data.
        return None, int((time.perf_counter()-started)*1000), type(exc).__name__
