# Independent reliability programme: implementation verification

Date: 2026-10-21. Branch: `feature/independent-verification`.
Starting commit: `e2598e3420c97d69b74a295a1a4a6fb34505ca8b` (main).
The older `feature/gradio-workflows` branch was v2.15 and did not contain the
requested frozen-review files; this isolated programme branch uses current
v2.37 without changing main or the earlier branch.

## Staged implementation

| Stage | Pushed implementation commit | Delivered | Remaining limits |
| --- | --- | --- | --- |
| 1 | 8949c0354a4248e5a464577af0f383eadc18624b | Blinded packets, two-or-more reviewer import, original rationales, confusion matrices, pairwise agreement/kappa, qualified Wilson interval | Genuine external reviewers, identity/conflict checks and completed findings PENDING |
| 2 | cd0c32c61a3413dcb4a9411d3fcb597861f42993 | Hashed datasets, partition sealing, duplicate/group leakage checks, five-state comparisons, grouped reports, synthetic scale fixture | External real-world breadth, calibration and truly held-out data PENDING |
| 3 | 2be7a4429eccbdf27bccfd296db135bd3684c6cb | Seven local CRM tasks, constrained JSON tool bridge, state verification, failures/retries, permissions, synthetic canary evidence | Live external agent runs and a remote runtime/connector adapter PENDING; not an OS sandbox |
| 4 | 09a5703c2b9ab71c225c451ae6e6565423f70e46 | Export manifests, source/version hashes, offline replay, linked revisions | Production export integration and external reproduction PENDING; saved-score mode replays arithmetic only |
| 5 | bf7261bf96aee84991ebd7c18074a6382ea569c9 | Separate research dimensions, evidence coverage, failures/unknowns, scoped repeats, no verification badge | Validated and approved production policy/UI changes PENDING |
| 6 | 40284402acc39f37ce66724dd1a2b5dbca6c3e50 | Initial independence charter, review procedure and methodology index | Adoption, accountable appointments and governance registers PENDING |
| 7 | This commit | CLI integration regression tests, release-gate repair, updated worker hash inventory and this report | Human/external validation is not replaced by these tests |

Each implementation stage was tested and pushed before the next began. Stages
1 through 5 passed the complete Python suite with respectively 1,194, 1,209,
1,225, 1,240 and 1,248 tests. Stage 6 is documentation-only; its relative links
and diff formatting were checked. No independent verdicts were generated.

## Final automated verification

| Check | Observed result |
| --- | --- |
| Full Python regression suite, `python -m pytest -q` | 1,253 passed; two dependency deprecation warnings |
| Node regression suite, `npm test` | 174 passed; zero failures/skips; existing module/config warnings |
| TypeScript, `npm run typecheck` | Passed |
| New CLI integration tests | 5 passed |
| Worker source inventory | 70 file hashes verified |
| Diff formatting | `git diff --check` clean |
| Production source and historical fixture preservation | No diff against starting commit for benchmarks, services, worker entrypoints, app/lib/components, database tree, existing tests/fixtures, requirements, package files or original review script |

The CLI integration path drove a synthetic CRM recovery trace through the JSON
bridge, captured a simulated 503 and subsequent successful state changes,
exported a manifest, replayed it and built a report. Reusing an output path left
the original file intact and failed. EOF/malformed driver input could not pass.
Incomplete reviewer submissions were rejected without emitting an analysis.
A generic evidence export path that could bypass the held-out release workflow
was found and closed: held-out datasets now require the dedicated custodian
workflow, with generic evidence export explicitly disabled for them.

Existing saved-run replay tests remain passing. They are existing version-specific
regressions over stored fixtures, not evidence that all historical published
scores have been independently audited. No production database was connected,
no historical row or score was written, and no live agent endpoint was called.
No paid infrastructure was provisioned or production deployment requested.

Original case SHA-256 remains
`9bf765396125dcc83a1abc41d59f18640ffcd8aabf746c16de1938fe8e99d472`.
Original developer-label SHA-256 remains
`cecb64a188e8dc8807b76101fd000c3605aa2b5899991b66bed63131157b8a3d`.
Evaluator `deterministic-v2.37`, interpreter `semantic-contract-v1.18`, suite `2.0`
and scoring policy `behavioural-v2.2` are unchanged. The current frozen development
comparison remains 24/30 matches, two false FAILs and four INDETERMINATE
mismatches, zero false PASSs **on that selected development set only**.

## What these checks establish

The tested tooling preserves frozen inputs, rejects missing evidence as a basis
for success, retains reviewer disagreement, separates evidence/infrastructure
states, verifies controlled state changes, detects changed artifacts relative
to trusted hashes and reproduces supported saved conclusions under matching
source rules. Safety failures cannot create a positive research readiness claim.
The report never authorises an independently verified badge.

The 408-row stress fixture is 17 correlated synthetic scenario families with
three simulated profiles and repeats. It verifies capacity/grouping, not broad
accuracy, real multi-agent performance or 408 independent observations. Local
workflow drivers are software fixtures, not real external agents. Hashes do not
prove origin, identity or independence, and the CLI release flag is not a storage
access-control boundary. Explicit custody is still required.

## Required next work before stronger claims

* Recruit and verify at least two independent human reviewers; distribute only
  the reviewer folder; collect and analyse genuine completed submissions.
* Assemble permitted real observations across multiple agent types, record
  provenance and independent labels, and establish calibration/held-out custody
  before tuning or unblinding. Retire exposed cases from future held-out claims.
* Run actual external agents through a properly contained workflow adapter;
  extend beyond the local CRM and literal canary checks with versioned contracts.
* Integrate permission-aware production exports and campaign completeness
  records, without rewriting historical results. Test permitted historical
  exports under their original source/dependency versions.
* Obtain independent expert reproduction and a governed decision under
  prospectively declared acceptance criteria. Adopt the charter and record
  conflicts, review authority, publication permission and correction handling.
* Propose, validate and explicitly approve any new production scoring policy or
  UI changes separately. None were activated here.

All external validation is **PENDING**. Passing software tests establishes neither
real-world evaluator accuracy nor organisational independence or accreditation.
The broad independently assessed BENCHRX claim in the programme brief is not
supported yet and must not be published as an accomplished fact.
