# External evaluator review workflow v1

## Status and scope

External validation is **PENDING**. The workflow is ready for human submissions;
software test fixtures are not reviewer evidence. Baseline: main commit
`e2598e3420c97d69b74a295a1a4a6fb34505ca8b`, evaluator `deterministic-v2.37`,
semantic interpreter `semantic-contract-v1.18`, scoring policy `behavioural-v2.2`,
benchmark suite `2.0`. Production evaluator and scoring are unchanged.

The original 30-case fixture and developer labels are retained byte for byte.
Case SHA-256: `9bf765396125dcc83a1abc41d59f18640ffcd8aabf746c16de1938fe8e99d472`.
The old review plan's v2.36 baseline is a historical observation, not a current
accuracy claim. These are selected synthetic/sanitized development examples in
three contract families, already visible to developers. An external review of
them cannot retroactively make them held-out or representative of real agents.

## Coordinator procedure

1. From the repository root run:
   `python scripts/external_evaluator_review.py prepare /tmp/benchrx-review-v1`
2. Give at least two external human reviewers **only the `reviewer/` folder**.
   Keep `coordinator.json`, evaluator source, developer labels, existing baseline
   and any other reviewers' submissions away from them until submission closes.
   The packet shuffles order and replaces original identifiers with opaque IDs.
   This reduces cues; it cannot undo previous exposure to the public dataset.
3. Each reviewer copies `submission-template.json` to a separate submission.
   Complete identity or stable pseudonym, ISO review date, conflicts (write
   `none declared` if appropriate), and each explicit boolean attestation.
   Record PASS, FAIL or INDETERMINATE and a nonempty contract-based rationale
   for every case. Record contract ambiguities in rationales. Never guess a
   label merely to complete the form: INDETERMINATE is an allowed finding.
4. Collect submissions separately. Preserve returned originals unchanged in
   access-controlled storage. Do not commit personal metadata to a public repo
   without permission. Do not publish other reviewers' opinions before closure.
5. After closure run:
   `python scripts/external_evaluator_review.py compare /tmp/benchrx-review-v1 reviewer-a.json reviewer-b.json --output analysis-v1.json`
   More than two reviewers are supported. Output creation refuses overwrite;
   corrections use a new filename and retain original artifacts. Packet and
   submission hashes bind the analysis to the returned material.
6. Verify reviewer identity, actual human participation, exposure history and
   conflicts outside the software. A boolean or pseudonym is not authentication.
   Record that verification separately with responsible coordinator and date.
   Conflicted/nonhuman/unblinded submissions remain visible and must not support
   an independence claim. The importer never automatically awards validation.
7. Preserve disagreements and both original rationales. Request a separately
   recorded adjudication with author, date, reasons and referenced submission
   hashes if necessary. Do not overwrite original labels, cherry-pick reviewers,
   or tune on these cases and then claim held-out validation.

## Interpretation

Reports contain every original submission, current evaluator predictions and
rationales, source hashes and versions, per-reviewer confusion matrices and all
pairwise reviewer comparisons. Matrix rows are the named reference reviewer and
columns the comparison reviewer or BENCHRX. Labels are opinions, not established
ground truth. `false_pass`, `false_fail`, and `incorrect_indeterminate` count the
respective predicted label when it differs from the reference, including an
INDETERMINATE reference. Consult the full matrix to distinguish clear opposites
from unresolved references. Pairwise counts describe disagreement, not which
human is correct. No majority vote or automatic consensus is substituted.

Exact agreement and Cohen's kappa are descriptive. Kappa is null if expected
chance agreement is one. The Wilson 95% interval is explicitly conditional on
an iid binomial model; these related, purposively selected cases do not support
population accuracy intervals. No uncertainty about a broad population can be
resolved by a narrow interval on this set. No single overall pooled metric is
reported, avoiding treating repeated labels on the same case as new cases.

Missing submissions, labels, rationales, wrong packet hashes, duplicate cases,
duplicate reviewer IDs and future dates fail closed. Infrastructure errors and
unavailable evidence are not behavioural labels here: the original case set
assumes successfully delivered text, and the importer rejects other verdicts.
This tool does not collapse production infrastructure/evidence states into FAIL
or PASS. It neither contacts agent endpoints nor accesses production databases.

## Remaining work

Recruit and verify independent people; obtain completed reviews; independently
adjudicate disputes; expand to prospectively held-out external examples. These
are PENDING. A public independent-verification claim remains unauthorised.

## Automated verification, 2026-10-21

`python -m pytest worker/tests/test_external_evaluator_review.py worker/tests/test_evaluator_review.py -q`: **21 passed**.
`python -m pytest -q`: **1,194 passed**, two dependency deprecation warnings.
`git diff --check`: clean. CLI packet generation succeeded. The unchanged
current development comparison is 24/30 matches, two false FAILs and four
INDETERMINATE disagreements against developer labels, zero false PASSs on this
selected set. No external reviewer results were supplied or generated.
