# Evidence manifest and offline replay v1

This is an offline export path; production storage, historical rows and scores
are untouched. It supports three explicitly different scopes:

| Kind | Reproduced result | Limitation |
| --- | --- | --- |
| validation_cases | Behavioural verdicts from saved permitted response observations and contracts | No live transport/extraction replay |
| crm_workflow | Tool trace, intermediate state hashes, final state, obligations and operational verdict | Synthetic environment only |
| saved_score_rows | Existing policy arithmetic and readiness gates from saved result rows | Does not re-verify the original behavioural verdicts |

Example:

```sh
python scripts/evidence_manifest.py --output /tmp/evidence-v1.json export crm_workflow /tmp/crm-run-001.json --agent-id controlled-driver-v1 --captured-at 2026-10-21T12:00:00+00:00 --limitation 'Synthetic local harness run; not an external agent evaluation.'
python scripts/evidence_manifest.py --output /tmp/replay-v1.json replay /tmp/evidence-v1.json
```

Each manifest contains an opaque agent configuration identifier (never credentials),
time with timezone, suite/policy/evaluator versions, source and artifact hashes,
contracts and permitted observations, conclusions, limitations and evidence
completeness in its payload. It records Python version and requirements-file hash.
Use the matching repository commit and Python/dependency environment for replay;
source or version mismatch fails closed. Do not download/execute source embedded
in an untrusted manifest. A hash is an integrity commitment relative to a trusted
copy, not a signature, trusted timestamp, identity proof or independent review.

`validation_cases` input follows the versioned dataset schema. Generic export
rejects held-out partitions; use the dedicated custodian release workflow, with
held-out manifest export integration still pending. `crm_workflow`
input is captured by the controlled bridge. `saved_score_rows` requires a
`versions` object with evaluator_version, scoring_policy_version and
benchmark_suite_version, plus `results` containing each planned test exactly
once, the original category, weight, observed/evidence_complete flags,
passed/score and any retained permitted evidence. Historical version mismatches
require the original checkout; never change version fields to force acceptance.
Connector error-handling diagnostics can pass while observed is false, because
they are not behavioural observations. This preserves existing semantics.

The current exporter does not fetch production runs or retrospectively certify
that old rows have complete responses. Any such integration remains PENDING.
Existing saved-run replay regressions remain in the suite. Do not claim that
arithmetic replay reproduces extraction or an earlier evaluator implementation.

## Data permissions and revisions

Only export material whose retention/sharing is permitted. This tool does not
automatically sanitise or publish evidence. Omit secret-bearing endpoint URLs;
use an opaque configuration ID. If a response cannot be retained, represent it
as unavailable with a limitation. Redaction may make re-evaluation impossible;
do not silently treat a redacted response as the original observation. Real
credentials must never be put into CRM fixtures or export examples.

Export paths refuse overwrite. Corrections use a new file with `--parent` and
`--correction-reason`, referencing the prior manifest hash. Retain both artifacts
and record any human approval/publication correction separately. Original data
is never rewritten by this tool. Hashes do not replace appropriate access control
or retention/deletion policy.

Replay compares the saved conclusion under the exact same rules. CRM replay
reconstructs each tool result and intermediate state hash before comparing the
final outcome. Capture timestamps are retained metadata rather than scoring
inputs. Live repeatability requires new real agent executions and is not implied.

15 focused tests cover saved cases, CRM retry traces, tampering, rule mismatch,
revisions, arithmetic, historical version rejection, missing evidence, altered
weights, diagnostic semantics and the existing safety veto. External inspection
and independent assessment remain PENDING.
