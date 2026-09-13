import {GradioInvocationError} from '../gradio-errors.ts';
import {discoverGradio} from './gradio-discovery.ts';
import {extractAssistantText, assistantOutputDiagnostic} from '../gradio-output.ts';
import {parsePlan, executeGradioPlan} from '../gradio-workflow.ts';
import {publicConnectorIO, type ConnectorDiagnostics, type ConnectorIO, type ConnectorProvider} from './interface.ts';
import type {ValidatedHttpsTarget} from '../pinned-https.ts';

type Connection = {space: ValidatedHttpsTarget; plan: ReturnType<typeof parsePlan>};
type Result = unknown[];

function safeGradioErrorDiagnostics(error: unknown): ConnectorDiagnostics | undefined {
  if (!(error instanceof GradioInvocationError)) return undefined;
  return {stage: error.stage, code: error.code,
    ...(typeof error.httpStatus === 'number' ? {httpStatus: error.httpStatus} : {}),
    ...(typeof error.stepIndex === 'number' ? {stepIndex: error.stepIndex} : {})};
}

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
    async invoke(c, input) {
      try {return await executeGradioPlan(c.space, c.plan, input.hasMessage ? input.message : undefined, io.request);}
      catch (error) {
        console.error('BENCHRX Gradio invocation failed', safeGradioErrorDiagnostics(error) ?? {stage: 'execution', code: 'failed'});
        throw error;
      }
    },
    extract,
    diagnose(c, result) {
      if (extract(c, result)) return {outcome: 'observed_response', status: 200};
      const diagnostics: ConnectorDiagnostics = {
        stage: 'output', code: assistantOutputDiagnostic(result[c.plan.finalStepIndex]), stepIndex: c.plan.finalStepIndex,
      };
      console.warn('BENCHRX Gradio output unavailable', diagnostics);
      return {outcome: 'unobserved_response', status: 502,
        error: 'Gradio completed but BENCHRX could not extract a text response.', diagnostics};
    },
    diagnoseError: safeGradioErrorDiagnostics,
    metadata(c) {return {targetHost: c.space.hostname, apiName: c.plan.steps[c.plan.finalStepIndex].apiName, workflowSteps: c.plan.steps.length, clientMode: 'pinned'};},
  };
}
export const gradioConnector = createGradioConnector();
