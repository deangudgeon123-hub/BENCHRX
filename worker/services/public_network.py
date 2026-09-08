from __future__ import annotations
import asyncio
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit
import httpcore
import httpx


def is_public_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
        if isinstance(address, ipaddress.IPv6Address) and (address.ipv4_mapped or address.sixtofour or address.teredo):
            return False
        return address.is_global and not address.is_multicast and not address.is_reserved
    except ValueError:
        return False


def validate_endpoint(url: str) -> None:
    parsed = urlsplit(url)
    host = (parsed.hostname or '').lower()
    if parsed.scheme != 'https' or parsed.port not in {None,443} or parsed.username or parsed.password or parsed.fragment:
        raise ValueError('Only public HTTPS endpoints on port 443 without URL credentials/fragments are supported')
    if not host or host == 'localhost' or host.endswith(('.localhost','.local','.internal')):
        raise ValueError('Public endpoint required')
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return
    if not is_public_address(host): raise ValueError('Non-public endpoint rejected')


class PublicNetworkBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, backend=None, resolver=None):
        self.backend = backend or httpcore.AnyIOBackend()
        self.resolver = resolver

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if port != 443: raise ValueError('Only HTTPS port 443 is supported')
        resolver = self.resolver or asyncio.get_running_loop().getaddrinfo
        records = await asyncio.wait_for(resolver(host,port,type=socket.SOCK_STREAM),timeout=min(timeout or 5,5))
        addresses = list(dict.fromkeys(r[4][0] for r in records))
        if not addresses or any(not is_public_address(a) for a in addresses): raise ValueError('Non-public DNS answer rejected')
        # Numeric connection avoids a second hostname resolution. HTTPCore retains the
        # original hostname for Host/SNI and certificate validation on start_tls.
        return await self.backend.connect_tcp(addresses[0],port,timeout=timeout,local_address=local_address,socket_options=socket_options)

    async def connect_unix_socket(self,*args,**kwargs): raise ValueError('Unix sockets are prohibited')
    async def sleep(self,seconds): await asyncio.sleep(seconds)


class CoreStream(httpx.AsyncByteStream):
    def __init__(self, stream): self.stream=stream
    async def __aiter__(self):
        async for part in self.stream: yield part
    async def aclose(self): await self.stream.aclose()


class PublicTransport(httpx.AsyncBaseTransport):
    def __init__(self, backend=None):
        self.pool=httpcore.AsyncConnectionPool(ssl_context=ssl.create_default_context(),network_backend=backend or PublicNetworkBackend(),max_connections=4,max_keepalive_connections=0,retries=0)
    async def handle_async_request(self, request):
        validate_endpoint(str(request.url))
        core_request=httpcore.Request(method=request.method,url=httpcore.URL(scheme=request.url.raw_scheme,host=request.url.raw_host,port=request.url.port,target=request.url.raw_path),headers=request.headers.raw,content=request.stream,extensions=request.extensions)
        response=await self.pool.handle_async_request(core_request)
        return httpx.Response(response.status,headers=response.headers,stream=CoreStream(response.stream),extensions=response.extensions)
    async def aclose(self): await self.pool.aclose()


def public_client():
    return httpx.AsyncClient(transport=PublicTransport(),timeout=60,follow_redirects=False,trust_env=False)
