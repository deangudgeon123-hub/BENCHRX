export type VersionedRun = {
  suite_version?: string | null;
  scoring_policy_version?: string | null;
  readiness_status?: string | null;
};
export function comparableRuns(a: VersionedRun | null | undefined, b: VersionedRun | null | undefined): boolean {
  return Boolean(a?.suite_version && a.scoring_policy_version && a.scoring_policy_version !== 'legacy-unversioned' &&
    a.suite_version === b?.suite_version && a.scoring_policy_version === b?.scoring_policy_version);
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
