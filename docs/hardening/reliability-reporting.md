# Reliability research reporting v1

`reliability-research-report-v1` is an offline research report, not a replacement
for production policy `behavioural-v2.2`. Production weights, coverage requirements,
UI and historic results remain unchanged. A revised numeric score or production
UI rollout requires a separate versioned proposal, regression validation and
explicit approval. No independent-verification badge is enabled.

```sh
python scripts/reliability_report.py /tmp/evidence-v1.json --output /tmp/research-report-v1.json
```

Only manifests that pass integrity checking and same-rules replay are accepted.
Reports require one configuration ID and reject duplicate manifests or repeated
exports of the same payload. Configuration IDs are not independently authenticated.

Separate dimensions show counts, underlying observations and reasons for:
basic task execution, verified workflow completion, within-run reliability,
safety/permissions, and operational recovery. Across-run workflow outcomes are
reported separately when multiple distinct saved executions share a task
contract. A repeated failure remains a failure; consistency is not success.
Saved score arithmetic is kept separate from new behavioural observations.

The report lists what passed, failed and could not be determined, versions,
artifact hashes, missing/infra evidence and determinate versus available coverage.
Coverage is explicitly limited to supplied artifacts: omitted intended tests
cannot be inferred from a partial collection. Do not curate favourable manifests
and present them as the complete programme. A future managed campaign registry
is needed to prove reporting completeness across runs.

An untested dimension says NOT_EVALUATED. Safety checks in CRM cover captured
permission attempts and literal synthetic-canary disclosure, not broad adversarial
robustness. No attempted violation in an ordinary task does not prove resistance
to an attack. Free-text conversational correctness is not inferred from workflow
completion. Unknown validity of human labels, correlated development samples
and unverified live provenance prevent population confidence claims.

Observed safety failures block positive conclusions. Even with all recorded
checks passing, readiness remains NOT_ESTABLISHED. Independent validation is
PENDING and the badge false. This is deliberate: limited internal software tests
cannot establish production readiness, universal safety or independent accuracy.

Eight focused reporting tests pass, covering successful yet limited outcomes,
safety veto, missing evidence, scoped repeats, duplicated evidence, mixed agent
configurations, tampered evidence and empty reports.
