import {appOrigin} from './access.ts';
import {isApplicationErrorOutput} from './application-error-output.ts';
import {a2aSuitability, type A2ASuitability} from '../connectors/a2a-suitability.ts';
import {publicConnectorIO, type ConnectorIO} from './connectors/interface.ts';

const ADAPTER_PATHS = new Set(['/api/adapters/generic','/api/adapters/gradio','/api/adapters/storkie','/api/adapters/a2a','/api/adapters/langgraph','/api/adapters/openai-agents']);
const MESSAGE = 'Reply briefly to confirm this BENCHRX connection test was received.';
export type PreflightResult = {ok: true; suitability?: A2ASuitability} | {ok: false; status: number; diagnostics?: {stage: string; code: string; httpStatus?: number}};

// A successful HTTP envelope is insufficient: the worker needs a usable response
// string. This probe checks connectivity only and never supplies benchmark evidence.
export async function preflightConnection(endpointUrl: string, io: ConnectorIO = publicConnectorIO): Promise<PreflightResult> {
  try {
    const endpoint = new URL(endpointUrl);
    const adapter = endpoint.origin === appOrigin() && ADAPTER_PATHS.has(endpoint.pathname.replace(/\/$/, ''));
    const headers: Record<string,string> = {'Content-Type':'application/json'};
    let body: Record<string,unknown> = {message: MESSAGE};
    if (adapter) {
      const secret = process.env.BENCHRX_ADAPTER_SECRET ?? '';
      if (secret.length < 32) return {ok:false,status:503,diagnostics:{stage:'configuration',code:'adapter_not_configured'}};
      headers.Authorization = `Bearer ${secret}`;
      if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      body = {...body,_benchrx_config:Object.fromEntries(endpoint.searchParams),_benchrx_connection_test:endpoint.pathname.replace(/\/$/, '') === '/api/adapters/a2a'};
      endpoint.search = '';
    }
    const target = await io.pin(endpoint.href,{invalidUrlMessage:'Invalid endpoint',httpsRequiredMessage:'Public HTTPS required'});
    const response = await io.request(target,{method:'POST',headers,body:JSON.stringify(body),timeoutMs:adapter && endpoint.pathname.replace(/\/$/, '') === '/api/adapters/gradio' ? 135000 : 65000,maxResponseBytes:1000000});
    let payload: unknown;
    try {payload = JSON.parse(response.text);} catch {payload = null;}
    const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string,unknown> : null;
    if (response.status < 200 || response.status >= 300) {
      // Only BENCHRX adapter-created diagnostics may be exposed, never native
      // agent payload fields or raw response content.
      const diagnostic = adapter && value?.diagnostics && typeof value.diagnostics === 'object' ? value.diagnostics as Record<string,unknown> : null;
      return {ok:false,status:response.status >= 400 && response.status <= 599 ? response.status : 502,
        ...(diagnostic && typeof diagnostic.code === 'string' && typeof diagnostic.stage === 'string' ? {diagnostics:{stage:diagnostic.stage,code:diagnostic.code,...(typeof diagnostic.httpStatus === 'number' ? {httpStatus:diagnostic.httpStatus} : {})}} : {})};
    }
    if (typeof value?.response !== 'string' || !value.response.trim()) return {ok:false,status:502,diagnostics:{stage:'extraction',code:'missing_response'}};
    // BENCHRX reports an unusable probe, never adopts a status claimed in text.
    if (isApplicationErrorOutput(value.response)) return {ok:false,status:502,diagnostics:{stage:'output',code:'application_error_output'}};
    return {ok:true, ...(adapter && endpoint.pathname.replace(/\/$/, '') === '/api/adapters/a2a'
      ? {suitability:a2aSuitability(value.response, value.inputModes)} : {})};
  } catch {
    return {ok:false,status:502,diagnostics:{stage:'connection_test',code:'request_failed'}};
  }
}
