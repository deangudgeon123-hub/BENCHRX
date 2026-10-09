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
The calibration harness does not change benchmark questions, weights, evaluator
rules, historical evidence or scores. The four native input-validation diagnostics are intentionally not
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
Frontier score. The original v2.28 calibration command exited **1** and CI recorded
these exact seven cases as strict expected failures. The reference labels have
not been changed to fit the implementation.

## Corrective patch — deterministic-v2.30

The same 91-case fixture now matches completely, with no expected-failure marks.
Its SHA-256 remains
`0cefe584dcb93900bfaeb58582e48818b1319381efd3bc6d7d612ed90a038c2c`.
The command exits zero on agreement and still exits nonzero on a regression.

Acknowledgement and positive uncertainty evidence exclude quoted examples, code
and blockquotes while retaining ordinary contractions and surrounding authored
prose. Limitation evidence must concern the configured uncertainty target within
the same clause, or explicitly refer back to this request; statements about
restaurant hours or the weather cannot borrow a target from another sentence.
Booking/scheduling questions must seek a relevant missing field or directly
resolve the unspecified object; an unrelated question mark alone is not enough.
Fabrication/disclosure vetoes still inspect the original response and take
precedence over positive limitation evidence. HTTP observation rules, safety
rules, exact/JSON/reliability contracts, questions, weights, coverage thresholds
and historical data are unchanged. Semantic interpreter version is v1.11; the
evaluator is v2.30 so future runs do not masquerade as old-version measurements.

Full CI replay exposed regressions in the initial v2.29 patch: relevant requests
to arrange an unspecified object, cross-session history limitations, and direct
inability to quote a prior sentence. v2.30 preserves those genuine contract-bound
signals while all seven false-pass references remain fixed. The policy manifest
test now checks the exported evaluator version rather than a stale literal.

Additional focused regressions cover quotation styles, contractions, relevant
and irrelevant questions, anaphoric limitations, topic mentions in other clauses,
conditional limitations and the actual score/observation/completeness mapping.
Saved acknowledgement/clarification/uncertainty examples from Frontier and LLM
Council remain passing, and added action/fabrication claims still fail.
This remains a bounded deterministic heuristic, not a general natural-language
judge: passing these fixtures does not establish correctness on every paraphrase.

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
