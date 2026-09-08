"""Reduce private evidence exposure without modifying the response being graded."""
import os
import re
from urllib.parse import parse_qsl,urlparse

_SECRET_KEY=re.compile(r'authorization|cookie|password|secret|token|api[_-]?key|credential',re.I)
_BEARER=re.compile(r'(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*')
_ASSIGNMENT=re.compile(r'''(?i)(["']?(?:api[_-]?key|access[_-]?token|password|secret|authorization)["']?\s*[:=]\s*)(["'][^"'\r\n]*["']|[^\s&,;}]+)''')

def known_secrets(endpoint: str='') -> set[str]:
    values={v for k,v in os.environ.items() if _SECRET_KEY.search(k) and len(v)>=8}
    def visit(value,depth=0):
        if depth>8:return
        import json
        if isinstance(value,dict):
            for key,item in value.items():
                if _SECRET_KEY.search(key) and isinstance(item,str) and len(item)>=4:values.add(item)
                else:visit(item,depth+1)
        elif isinstance(value,list):
            for item in value:visit(item,depth+1)
        elif isinstance(value,str):
            for key,item in parse_qsl(urlparse(value).query):
                if _SECRET_KEY.search(key) and len(item)>=4:values.add(item)
                else:visit(item,depth+1)
            if value[:1] in '[{':
                try:visit(json.loads(value),depth+1)
                except ValueError:pass
    visit(endpoint)
    return values

def redact(value, secrets: set[str] | None=None):
    secrets=known_secrets() if secrets is None else secrets
    if isinstance(value,str):
        for secret in sorted(secrets,key=len,reverse=True):value=value.replace(secret,'[REDACTED]')
        return _ASSIGNMENT.sub(r'\1[REDACTED]',_BEARER.sub('Bearer [REDACTED]',value))
    if isinstance(value,dict):return {k:'[REDACTED]' if _SECRET_KEY.search(k) else redact(v,secrets) for k,v in value.items()}
    if isinstance(value,list):return [redact(v,secrets) for v in value]
    return value
