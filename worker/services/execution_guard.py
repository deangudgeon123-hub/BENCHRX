"""Authenticate before parsing request bodies and bound execution command envelopes."""
import asyncio
from fastapi import HTTPException
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from services.worker_auth import require_worker_auth

class ExecutionGuard:
    def __init__(self, app):self.app=app
    async def __call__(self,scope,receive,send):
        if scope['type']!='http' or scope['path'] not in {'/trigger','/run-next'}:
            return await self.app(scope,receive,send)
        try:require_worker_auth(Headers(scope=scope).get('authorization'))
        except HTTPException as exc:
            return await JSONResponse({'detail':exc.detail},status_code=exc.status_code)(scope,receive,send)
        body=bytearray()
        try:
            async with asyncio.timeout(10):
                while True:
                    message=await receive()
                    if message['type']=='http.disconnect':return
                    body.extend(message.get('body',b''))
                    if len(body)>2048:
                        return await JSONResponse({'detail':'Command body too large'},status_code=413)(scope,receive,send)
                    if not message.get('more_body'):break
        except TimeoutError:
            return await JSONResponse({'detail':'Command body timed out'},status_code=408)(scope,receive,send)
        delivered=False
        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered=True
                return {'type':'http.request','body':bytes(body),'more_body':False}
            return await receive()
        await self.app(scope,bounded_receive,send)
