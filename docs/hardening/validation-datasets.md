# Validation datasets v1

This offline framework adds no production scoring changes. External calibration,
held-out datasets and independently authenticated labels remain **PENDING**.

## Commands

```sh
python scripts/generate_validation_development.py /tmp/development.json
python scripts/validation_dataset.py --output /tmp/partitions.json seal /tmp/development.json
python scripts/validation_dataset.py --output /tmp/analysis.json evaluate /tmp/development.json --manifest /tmp/partitions.json
```

The generated development stress set has 408 rows, 17 scenario families and
three **simulated** agent-type profiles. Repetitions deliberately exercise scale
and grouped analysis. They are correlated copies, not 408 independent examples
or observations of real agents. Generated reference labels are development
expectations only. They do not establish broad evaluator accuracy. The reasoning
failure case is an arithmetic answer check, not a verified multi-step workflow;
operational reasoning requires the separate controlled workflow suite.

## External dataset contract

Each partition is a separate JSON file with `schema: validation-dataset-v1`, a
nonempty `version`, `partition` (development, calibration, held_out), and `cases`.
The generator demonstrates the full schema. Cases require:

* Unique `id`, family `group_id`, `agent_type`, `scenario`.
* Complete version-frozen contract with prompt(s), kind, description and output
  constraints, rather than a mutable pointer to a live benchmark definition.
* `provenance` with kind (`external` or `synthetic_development`), source,
  collection date and permitted-use basis. Use synthetic credentials only.
* `evidence` with explicit observed/infra_error/unavailable status. Observed
  repeated tasks include every response; absent evidence needs a reason.
* `reference` with verdict, rationale, labeler ID, date and explicit
  `independent_human` boolean. This is an attestation, not authentication.

Five states remain distinct in all matrices: PASS, FAIL, INDETERMINATE,
INFRA_ERROR, EVIDENCE_UNAVAILABLE. A matching output attached to an unavailable
observation can never pass. Case-level predictions retain rationales. Reports
break out scenario and agent type, so systematic disagreements stay visible.

## Partition custody and independence

A dataset custodian should collect multiple real agent types and prospectively
assign related tasks, paraphrases, agents/sessions where appropriate, and repeat
families to a single partition. Submit all three files together to `seal`.
This rejects overlapping IDs, group families and exact evidence/contract copies,
and records byte hashes, group commitments, counts and the evaluator source
fingerprint. It cannot detect undisclosed semantic paraphrases or a dishonest
source. The custodian must review groups and provenance manually.

Do not put held-out contents in the developer workspace or public repository.
The custodian keeps labels and evidence in separate restricted storage and
publishes only commitments. Developers tune on development and use calibration
according to a predeclared protocol. Before releasing held-out evidence, freeze
the evaluator and seal the final manifest. The custodian then runs `evaluate`
with `--release-held-out`; changed evaluator fingerprints are rejected.

CLI release is a deliberate gate, **not an access-control system**. Keep files
out of developers' reach through storage permissions and independent custody.
After unblinding, those cases are spent for future tuning decisions; obtain a
new held-out version. Maintain an external release/access log with custodian,
time, purpose, manifest hash, evaluator hash and review identities. Never claim
that a self-reported provenance field proves independence.

Sealed bytes cannot be edited in place and still pass verification. Corrections
require new versioned files and a new manifest, retaining the previous ones.
The CLI refuses to overwrite output files. No external observations or human
labels have been fabricated to fill calibration or held-out partitions.

## Verification

15 focused tests pass, including the 408-row path, all five evidence states,
repeat completeness, invalid schemas, cross-partition leakage, hash changes,
and explicit held-out release under frozen code. This verifies software
behaviour, not the accuracy of labels or generalisation to real agent behaviour.
