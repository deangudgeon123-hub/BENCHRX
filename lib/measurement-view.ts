export type VersionedRun = {
  suite_version?: string | null;
  scoring_policy_version?: string | null;
  evaluator_version?: string | null;
  readiness_status?: string | null;
};
export function comparableRuns(a: VersionedRun | null | undefined, b: VersionedRun | null | undefined): boolean {
  return Boolean(a?.suite_version && a.scoring_policy_version && a.scoring_policy_version !== 'legacy-unversioned' &&
    a.evaluator_version && a.suite_version === b?.suite_version &&
    a.scoring_policy_version === b?.scoring_policy_version && a.evaluator_version === b?.evaluator_version);
}

export type MeasurementResult = {
  passed: boolean | null;
  score: number | null;
  raw_response: Record<string, unknown> | null;
};

export function resultState(result: MeasurementResult): 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'UNOBSERVED' | 'NOT APPLICABLE' {
  const evidence = result.raw_response;
  if (evidence?.diagnostic_applicable === false) return 'NOT APPLICABLE';
  if (evidence?.outcome_type === 'unobserved' || evidence?.outcome_type === 'unobserved_upstream_error' || evidence?.observed === false && evidence?.outcome_type !== 'connector_diagnostic') return 'UNOBSERVED';
  if (result.passed === null) return 'INCONCLUSIVE';
  return result.passed ? 'PASS' : 'FAIL';
}
export function readinessLabel(run: VersionedRun, score: number | null): string {
  if (!run.scoring_policy_version || run.scoring_policy_version === 'legacy-unversioned') return 'Legacy benchmark result';
  if (run.readiness_status === 'blocked_safety') return 'Safety gate failed';
  if (run.readiness_status === 'insufficient_evidence' || score === null) return 'Insufficient evidence';
  if (run.readiness_status === 'meets_benchmark_gates') return 'Meets benchmark gates';
  if (run.readiness_status === 'meets_structured_capability_gates') return 'A2A compatibility passed';
  return 'Needs review';
}

export function diagnosticSummary(results: {passed: boolean | null}[]): string {
  const evaluated = results.filter(result => result.passed !== null);
  const passed = evaluated.filter(result => result.passed === true).length;
  const unevaluated = results.length - evaluated.length;
  if (!evaluated.length) return 'Not evaluated';
  return `${passed}/${evaluated.length} passed${unevaluated ? ` · ${unevaluated} not evaluated` : ''}`;
}

// Presentation only: recorded verdicts and policy gates remain unchanged.
export function withholdingReason(reason: string, results: (MeasurementResult & {test_cases?: {key: string} | {key: string}[] | null})[]): string {
  const match = /^(Missing mandatory observation|Missing complete behavioural observation): (.+)$/.exec(reason);
  if (!match) return reason;
  const result = results.find(result => {
    const test = Array.isArray(result.test_cases) ? result.test_cases[0] : result.test_cases;
    return test?.key === match[2];
  });
  const state = result ? resultState(result) : null;
  if (state === 'INCONCLUSIVE') return `Response received, but no conclusive verdict: ${match[2]}`;
  if (state === 'UNOBSERVED') return `No usable behavioural response: ${match[2]}`;
  return reason;
}

export function behaviouralEvidenceSummary(results: MeasurementResult[]): string {
  const states = results.map(resultState);
  const conclusive = states.filter(state => state === 'PASS' || state === 'FAIL').length;
  const inconclusive = states.filter(state => state === 'INCONCLUSIVE').length;
  const unobserved = states.filter(state => state === 'UNOBSERVED').length;
  return `${conclusive} conclusive checks · ${inconclusive} responses inconclusive · ${unobserved} without usable behavioural responses`;
}
