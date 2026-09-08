import {createHash,timingSafeEqual} from 'node:crypto';
export function secretMatches(value: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || !value) return false;
  return timingSafeEqual(createHash('sha256').update(value).digest(),createHash('sha256').update(expected).digest());
}
export function operatorAuthorized(headers: Headers): boolean {
  const authorization=headers.get('authorization') ?? '';
  if (!authorization.startsWith('Basic ')) return false;
  const decoded=Buffer.from(authorization.slice(6),'base64').toString('utf8');
  return secretMatches(decoded,process.env.BENCHRX_ADMIN_TOKEN ? `benchrx:${process.env.BENCHRX_ADMIN_TOKEN}` : undefined) && (process.env.BENCHRX_ADMIN_TOKEN?.length ?? 0)>=32;
}
export function requireOperator(request: Request): Response | null {
  if (!operatorAuthorized(request.headers)) return new Response('Operator access required',{status:401,headers:{'WWW-Authenticate':'Basic realm="BENCHRX private hardening"','Cache-Control':'no-store'}});
  const origin=request.headers.get('origin');
  if (origin && origin!==new URL(request.url).origin) return new Response('Forbidden',{status:403});
  return null;
}
export function requireAdapter(request: Request): Response | null {
  return secretMatches(request.headers.get('authorization'),process.env.BENCHRX_ADAPTER_SECRET ? `Bearer ${process.env.BENCHRX_ADAPTER_SECRET}`:undefined) && (process.env.BENCHRX_ADAPTER_SECRET?.length ?? 0)>=32 ? null : new Response('Unauthorized',{status:401});
}
export function appOrigin(): string {
  const origin=process.env.BENCHRX_APP_ORIGIN;
  if (!origin) throw new Error('Application origin is not configured');
  const url=new URL(origin);
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw new Error('Invalid application origin');
  return url.origin;
}
export async function readBoundedJson(request: Request, maxBytes=32768): Promise<Record<string,unknown>> {
  const reader=request.body?.getReader();
  if (!reader) throw new Error('JSON body required');
  let size=0;const chunks: Uint8Array[]=[];
  try {
    const deadline=Date.now()+10000;
    while(true) {let timer:ReturnType<typeof setTimeout>|undefined;
    const {done,value}=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Request body deadline exceeded")),Math.max(1,deadline-Date.now()));})]).finally(()=>{if(timer)clearTimeout(timer)});if(done)break;size+=value.length;if(size>maxBytes)throw new Error('Request too large');chunks.push(value);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error('JSON object required');
    return body;
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// Connector configuration travels in an authenticated POST body, never a request URL.
export function adapterConfig(body: Record<string,unknown>): URLSearchParams {
  const value=body._benchrx_config;
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Connector configuration required');
  const params=new URLSearchParams();
  for (const [key,item] of Object.entries(value)) {
    if(typeof item!=='string') throw new Error('Invalid connector configuration');
    params.set(key,item);
  }
  return params;
}
