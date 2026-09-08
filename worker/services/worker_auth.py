import os
import secrets
from fastapi import Header, HTTPException

def require_worker_auth(authorization: str | None = Header(default=None)) -> None:
    expected=os.getenv('BENCHMARK_API_SECRET','')
    if len(expected)<32:
        raise HTTPException(status_code=503,detail='Worker execution is not configured')
    if not authorization or not secrets.compare_digest(authorization.encode(),('Bearer '+expected).encode()):
        raise HTTPException(status_code=401,detail='Unauthorized')
