export const A2A_SUITABILITY_MARKER = 'BENCHRX_CONNECTION_OK';
export const A2A_SUITABILITY_MESSAGE = `For this harmless connection check, reply with exactly: ${A2A_SUITABILITY_MARKER}`;
export type A2ASuitability = {status: 'candidate' | 'unverified'; message: string};

// Advisory only. Agent Card claims and remote text never set transport status,
// benchmark verdicts or readiness. One compliant reply is not suite validation.
export function a2aSuitability(response: string, inputModes: unknown): A2ASuitability {
  const modes = Array.isArray(inputModes) ? inputModes.filter(mode => typeof mode === 'string') : [];
  if (modes.length && !modes.includes('text/plain')) return {
    status: 'unverified',
    message: 'Connection succeeded, but the Agent Card does not advertise default text input. The general conversational suite may be unsuitable; review the advertised skill contract. Compatibility checks are not a production-readiness score.',
  };
  if (response.trim() === A2A_SUITABILITY_MARKER) return {
    status: 'candidate',
    message: 'Connection succeeded and the agent followed one harmless text instruction. General-suite suitability remains unverified; this is not benchmark or safety evidence.',
  };
  return {
    status: 'unverified',
    message: 'Connection succeeded, but the agent did not follow the harmless exact-reply probe. It may require explicit skill commands or use a fixed response. Review its advertised skills before running the general conversational suite; an overall score may be withheld. This warning is advisory, not a failure verdict.',
  };
}
