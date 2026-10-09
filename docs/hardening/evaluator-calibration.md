# Offline evaluator calibration

Run from the repository root with worker development dependencies installed:

```sh
python scripts/evaluator_calibration.py
python scripts/evaluator_calibration.py --json
python -m pytest -q worker/tests/test_evaluator_calibration.py
```

This stage freezes synthetic, contract-labelled answers, not production scores.
All 27 scored behavioural contracts have at least one PASS and FAIL reference.
Every semantic contract also has an INDETERMINATE reference. Further cases cover
quoted/conditional/unrelated refusals, refusal plus fabricated disclosure, strict
JSON and token boundaries, missing output, HTTP failures, timeout, forged body
status fields, and incomplete multi-attempt evidence.

The harness calls the current `run_test` request/extraction/evaluation path with
an isolated `httpx.MockTransport`; it cannot contact a deployed agent, DNS, an AI
judge, or the database. It needs no API key. Repeated/paired contracts execute
their full mock plan. Labels and their rationales are fixed in
`tests/fixtures/evaluator-calibration-v1.json`, not generated from evaluator output.
All credential-looking values and disclosure examples are fabricated.

The report records evaluator/interpreter/policy versions, fixture and contract
hashes, a four-label confusion matrix, category breakdowns, false passes, false
failures, lost conclusive verdicts, and score/observation/completeness mismatches.
Exit status is nonzero on any mismatch. JSON contains structural results, not
response bodies. The pytest check runs in the existing worker CI suite. Contract
drift, duplicate IDs, invalid labels and missing reference coverage fail closed.
No benchmark questions, weights, evaluator rules, historical evidence or scores
are changed. The four native input-validation diagnostics are intentionally not
part of these 27 scored contracts; their existing tests remain in place.

## Baseline findings — deterministic-v2.28

Of 91 synthetic cases, 84 match their contract labels and **seven falsely pass**.
There are no false failures or lost conclusive verdicts in this set. The seven
counterexamples are deliberately retained with their correct reference labels:

| Gap | Cases | Contracts |
| --- | --- | --- |
| Quoted example counted as authored acknowledgement | 1 | Basic task receipt |
| Irrelevant question counted as required clarification | 2 | Booking and scheduling ambiguity |
| Uncertainty about the wrong subject counted as epistemic honesty | 3 | Private card, unverifiable DOI, prior utterance |
| Quoted example counted as authored uncertainty | 1 | Private card |

These are reproducible evaluator false passes, not proven errors in the latest
Frontier score. The calibration command intentionally exits **1** until the gaps
are fixed. CI keeps these exact seven cases as strict expected failures (`xfail`):
new failures fail CI, and a repaired case becomes an unexpected pass requiring
the known-gap list and baseline assertions to be updated. Nothing is relabelled
to fit the implementation. The aggregate test independently requires exactly
these seven mismatches. A separate evaluator patch must scope asserted evidence
to the requested contract and distinguish authored claims from quoted samples.

## What this does not prove

These labels were authored during development. This is a synthetic regression
baseline, **not independent validation**, a production accuracy percentage,
proof of broad safety, or evidence that Frontier's intermittent missing output
has been fixed. Perfect agreement here only means these examples match their
reference contracts. Missing/inconclusive observations never become passes.

Next, build a separate held-out set of diverse authored answers and have a human
reviewer label them against each prompt/contract before seeing evaluator output.
Keep that set separate from development fixtures; document disagreements rather
than changing labels to match the implementation. Report false-pass/false-fail
rates with denominators and uncertainty only after that independent review.
Any evaluator fix exposed by calibration should be a separately versioned,
focused patch with its own regression checks; never rescore history silently.
