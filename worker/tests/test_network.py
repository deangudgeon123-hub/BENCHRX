import socket
import pytest
from services.public_network import is_public_address,validate_endpoint,PublicNetworkBackend
@pytest.mark.parametrize('value',['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','::1','::ffff:7f00:1','::ffff:169.254.169.254','fe80::1','fc00::1','192.0.2.1','224.0.0.1','2002:7f00:1::'])
def test_private_special_addresses_rejected(value): assert not is_public_address(value)
@pytest.mark.parametrize('url',['http://example.com','https://example.com:8080','https://user:secret@example.com','https://localhost','https://[::1]','https://example.com/#secret'])
def test_invalid_endpoints_rejected(url):
 with pytest.raises(ValueError):validate_endpoint(url)
@pytest.mark.asyncio
async def test_all_answers_validated_and_numeric_address_connected():
 class Backend:
  def __init__(self):self.host=None
  async def connect_tcp(self,host,*args,**kwargs):self.host=host;return 'stream'
 b=Backend()
 async def public(*args,**kwargs):return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',443))]
 assert await PublicNetworkBackend(b,public).connect_tcp('example.com',443)=='stream'
 assert b.host=='93.184.216.34'
 async def mixed(*args,**kwargs):return await public()+[(socket.AF_INET6,socket.SOCK_STREAM,6,'',('::1',443,0,0))]
 with pytest.raises(ValueError):await PublicNetworkBackend(b,mixed).connect_tcp('example.com',443)

@pytest.mark.asyncio
async def test_only_trusted_adapter_gets_secrets_and_query_moves_to_body(monkeypatch):
 import json,httpx
 from services import agent_client
 monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS','https://benchrx.example')
 monkeypatch.setenv('BENCHRX_ADAPTER_SECRET','a'*32)
 monkeypatch.setattr(agent_client,'VERCEL_AUTOMATION_BYPASS_SECRET','fixture-bypass')
 seen=[]
 def reply(request):seen.append(request);return httpx.Response(200,json={'response':'READY'})
 async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as c:
  await agent_client.send_request(c,'https://benchrx.example/api/adapters/generic?fixedBody=secret-configuration',{'message':'fixture'})
  await agent_client.send_request(c,'https://attacker.example/?next=/api/adapters/generic',{'message':'fixture'})
 assert not seen[0].url.query
 assert seen[0].headers['authorization']=='Bearer '+'a'*32
 assert seen[0].headers['x-vercel-protection-bypass']=='fixture-bypass'
 assert json.loads(seen[0].content)['_benchrx_config']['fixedBody']=='secret-configuration'
 assert 'authorization' not in seen[1].headers and 'x-vercel-protection-bypass' not in seen[1].headers

STAGING_ORIGIN = 'https://benchrx-git-feature-security-meas-5661b1-dean-gudgeons-projects.vercel.app'
STAGING_ENDPOINT = STAGING_ORIGIN + '/api/adapters/gradio?space=https%3A%2F%2Fapodex-frontier-agent-demo.hf.space&apiName=_run&inputs=%5B%22%7B%7Bmessage%7D%7D%22%5D&outputIndex=3'

@pytest.mark.asyncio
@pytest.mark.parametrize('bypass,expected_status', [('',401),('revoked-fixture',401),('valid-fixture',200)])
async def test_staging_gradio_requires_independent_deployment_bypass(monkeypatch,bypass,expected_status):
    import json,httpx
    from services import agent_client
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS',' \n'+STAGING_ORIGIN+'/\n ')
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET','a'*32)
    monkeypatch.setattr(agent_client,'VERCEL_AUTOMATION_BYPASS_SECRET',bypass)
    def protected_adapter(request):
        # Application Authorization succeeds in all three cases. The Vercel gate
        # is independent and runs before BENCHRX's requireAdapter handler.
        assert request.headers['authorization']=='Bearer '+'a'*32
        assert str(request.url)==STAGING_ORIGIN+'/api/adapters/gradio'
        body=json.loads(request.content)
        assert body['_benchrx_config']['outputIndex']=='3'
        assert body['_benchrx_config']['inputs']=='["{{message}}"]'
        if request.headers.get('x-vercel-protection-bypass')!='valid-fixture':
            return httpx.Response(401,json={'error':{'message':'Protected deployment'},'protection':{'vercel_auth_enabled':True}})
        return httpx.Response(200,json={'response':'READY'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(protected_adapter)) as client:
        response,_,error=await agent_client.send_request(client,STAGING_ENDPOINT,{'message':'fixture'})
    assert error is None and response.status_code==expected_status

@pytest.mark.asyncio
async def test_pinned_transport_serializes_both_auth_headers_for_staging(monkeypatch):
    import httpcore,httpx
    from services import agent_client
    from services.public_network import PublicTransport
    host=STAGING_ORIGIN.removeprefix('https://')
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS',STAGING_ORIGIN)
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET','a'*32)
    monkeypatch.setattr(agent_client,'VERCEL_AUTOMATION_BYPASS_SECRET','valid-fixture')
    wire=bytearray()
    class Stream(httpcore.AsyncNetworkStream):
        async def write(self,buffer,timeout=None):wire.extend(buffer)
        async def read(self,max_bytes,timeout=None):
            return b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{"response":"READY"}'
        async def aclose(self):pass
        async def start_tls(self,ssl_context,server_hostname=None,timeout=None):
            assert server_hostname==host
            return self
        def get_extra_info(self,info):return None
    class Backend:
        async def connect_tcp(self,address,port,**kwargs):
            assert address=='93.184.216.34' and port==443
            return Stream()
    async def resolver(*args,**kwargs):
        return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',443))]
    async with httpx.AsyncClient(transport=PublicTransport(PublicNetworkBackend(Backend(),resolver))) as client:
        response,_,error=await agent_client.send_request(client,STAGING_ENDPOINT,{'message':'fixture'})
    assert error is None and response.status_code==200
    headers,body=bytes(wire).split(b'\r\n\r\n',1)
    assert headers.startswith(b'POST /api/adapters/gradio HTTP/1.1\r\n')
    assert b'authorization: bearer '+b'a'*32 in headers.lower()
    assert b'x-vercel-protection-bypass: valid-fixture' in headers.lower()
    assert b'_benchrx_config' in body
