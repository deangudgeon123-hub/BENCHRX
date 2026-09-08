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
