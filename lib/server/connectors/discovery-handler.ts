import {requireOperator, readBoundedJson} from '../access.ts';
import {gradioConnector} from './gradio.ts';
import type {ConnectorDiscovery} from '../../connectors/types.ts';

// Bounded per-process admission supplements operator authentication. No public onboarding.
export function createDiscoveryHandler(discover: (url: string) => Promise<ConnectorDiscovery> = url => gradioConnector.discover(url)) {
  let active = 0;
  let starts: number[] = [];
  const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
  return async (request: Request): Promise<Response> => {
    const denied = requireOperator(request);
    if (denied) return denied;
    const now = Date.now();
    starts = starts.filter(time => now - time < 60000);
    if (active >= 2 || starts.length >= 20) return json({error: 'Discovery is busy. Try again shortly; manual configuration is still available.'}, 429);
    active++; starts.push(now);
    try {
      const body = await readBoundedJson(request, 4096);
      if (typeof body.spaceUrl !== 'string' || body.spaceUrl.length > 2048 || !body.spaceUrl.trim()) return json({error: 'Enter a public Gradio or Hugging Face Space URL.'}, 400);
      return json(await discover(body.spaceUrl));
    } catch {
      // Never return remote exceptions, schema contents, URLs, credentials or auth headers.
      return json({error: 'Discovery could not identify a supported public Gradio API. Try the direct Space URL or use manual configuration.'}, 422);
    } finally {active--;}
  };
}
