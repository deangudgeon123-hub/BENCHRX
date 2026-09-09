import {discoverGradio} from './gradio-discovery.ts';
import {extractAssistantText} from '../gradio-output.ts';
import {parsePlan, executeGradioPlan} from '../gradio-workflow.ts';
import {publicConnectorIO, type ConnectorIO, type ConnectorProvider} from './interface.ts';
import type {ValidatedHttpsTarget} from '../pinned-https.ts';

type Connection = {space: ValidatedHttpsTarget; plan: ReturnType<typeof parsePlan>};
type Result = unknown[];
export function createGradioConnector(io: ConnectorIO = publicConnectorIO): ConnectorProvider<Connection, Result> {
  const extract = (c: Connection, result: Result) => extractAssistantText(result[c.plan.finalStepIndex]);
  return {
    id: 'gradio',
    async discover(url) {return discoverGradio(url, io);},
    async validate(config) {
      const space = await io.pin(config.get('space')?.trim() ?? '', {invalidUrlMessage: 'Enter a valid Gradio Space URL.', httpsRequiredMessage: 'Gradio Space endpoints must use HTTPS.'});
      const plan = parsePlan(config.get('inputs') ?? '[]', config.get('apiName') ?? 'chat', config.get('outputIndex') ?? '0');
      return {space, plan};
    },
    async invoke(c, input) {return executeGradioPlan(c.space, c.plan, input.hasMessage ? input.message : undefined, io.request);},
    extract,
    diagnose(c, result) {return extract(c, result) ? {outcome: 'observed_response', status: 200} : {outcome: 'unobserved_response', status: 502, error: 'Gradio completed but BENCHRX could not extract a text response.'};},
    metadata(c) {return {targetHost: c.space.hostname, apiName: c.plan.steps[c.plan.finalStepIndex].apiName, workflowSteps: c.plan.steps.length, clientMode: 'pinned'};},
  };
}
export const gradioConnector = createGradioConnector();
