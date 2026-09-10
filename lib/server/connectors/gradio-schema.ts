import type {GradioCapabilities, GradioEndpoint, GradioParameter, GradioWireSlot} from '../../connectors/types.ts';

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

// Candidates are schema evidence, not a claim that a route works or that an endpoint
// is suitable for the suite. Selection and live validation remain separate steps.
export function schemaCapabilities(inputs: GradioParameter[], outputs: GradioParameter[]): GradioCapabilities {
  const indices = (values: GradioParameter[], accepts: (p: GradioParameter) => boolean) =>
    values.flatMap((p, i) => accepts(p) ? [i] : []);
  return {
    textInputCandidates: indices(inputs, p => !p.state && /^(string|str)$/.test(p.type)),
    structuredInputCandidates: indices(inputs, p => !p.state && /^(object|dict|array|list)$/.test(p.type)),
    assistantOutputCandidates: indices(outputs, p => !p.state && (/^(string|str)$/.test(p.type) || p.component === 'chatbot')),
    invocation: 'unverified', textSuite: 'unverified', workflow: 'unknown',
  };
}

// /info may omit State positions. Keep the wire graph separate from visible arity;
// never silently align incomplete or duplicate component metadata by array position.
export function enrichSchemaGraph(endpoints: GradioEndpoint[], raw: unknown): GradioEndpoint[] {
  const config = object(raw);
  if (!Array.isArray(config.dependencies) || config.dependencies.length > 128 ||
      !Array.isArray(config.components) || config.components.length > 1024) return endpoints;
  const dependencies = config.dependencies;
  const components = new Map<number, Record<string, unknown>>();
  for (const entry of config.components) {
    const c = object(entry);
    if (!Number.isSafeInteger(c.id) || Number(c.id) < 0 || components.has(Number(c.id))) return endpoints;
    components.set(Number(c.id), c);
  }
  const slots = (rawIds: unknown): GradioWireSlot[] | null => {
    if (!Array.isArray(rawIds) || rawIds.length > 64) return null;
    let visibleIndex = 0;
    const result: GradioWireSlot[] = [];
    for (const [wireIndex, id] of rawIds.entries()) {
      const c = components.get(id);
      if (!Number.isSafeInteger(id) || !c || typeof c.type !== 'string') return null;
      const state = c.type.toLowerCase() === 'state';
      result.push({componentId: id, wireIndex, state, hidden: state || object(c.props).visible === false,
        ...(state ? {} : {visibleIndex: visibleIndex++})});
    }
    return result;
  };
  const annotate = (parameters: GradioParameter[], wire: GradioWireSlot[]) => {
    const visible = wire.filter(p => !p.state);
    const aligned = wire.length === parameters.length ? wire : visible.length === parameters.length ? visible : null;
    return aligned ? parameters.map((p, i) => ({...p, ...aligned[i]})) : parameters;
  };
  return endpoints.map(e => {
    const matches = dependencies.filter((raw: unknown) => {
      const name = object(raw).api_name;
      return typeof name === 'string' && name.replace(/^\//, '') === e.apiName;
    }).map(object);
    if (matches.length !== 1) return e;
    const d = matches[0], inputs = slots(d.inputs), outputs = slots(d.outputs);
    if (!inputs || !outputs) return e;
    const enrichedInputs = annotate(e.inputs, inputs), enrichedOutputs = annotate(e.outputs, outputs);
    return {...e, inputs: enrichedInputs, outputs: enrichedOutputs,
      dependency: {id: Number.isSafeInteger(d.id) && Number(d.id) >= 0 ? Number(d.id) : null,
        triggerAfter: Number.isSafeInteger(d.trigger_after) && Number(d.trigger_after) >= 0 ? Number(d.trigger_after) : null,
        inputs, outputs},
      capabilities: {...schemaCapabilities(enrichedInputs, enrichedOutputs),
        workflow: inputs.some(p => p.state) ? 'shared_state_required' as const : 'dependency_declared' as const},
    };
  });
}
