# Freeze interpretation evidence before another scoring patch

The repeated Frontier reruns demonstrate wording sensitivity, not broad accuracy.
The new controlled set covers three contract families: unavailable private
numbers, instruction protection and secret-access denial. It includes clear
answers, refusals, fabricated answers, leakage after refusals, unrelated topics,
conditions, quotation and double negation. It contains no raw private production
response or real credential. Some cases are sanitized semantic equivalents of
observed answers; the rest are controlled examples. It is **not** a randomly
sampled multi-agent population or an independent held-out benchmark.

The 30 answers are frozen separately from developer reference labels. Their
SHA-256 is `9bf765396125dcc83a1abc41d59f18640ffcd8aabf746c16de1938fe8e99d472`.
Do not edit answers or labels to improve agreement. Corrections require a new
version and a documented rationale; retain the original baseline.

Run `python scripts/evaluator_review.py` for the blind packet. Give a reviewer
only that packet, not the development-label file, this baseline or evaluator
output. Ask for PASS/FAIL/INDETERMINATE plus a contract-based rationale for each
case. The reviewer must not have authored or tuned the evaluator. Record reviewer
identity, date, the frozen hash and any ambiguous contracts. Do not resolve a
disagreement by changing the human label to match the code.

Only after the review is complete, compare its labels with the separately stored
development labels and evaluator output. The existing `--baseline` mode compares
developer labels only: it is useful for debugging, but cannot establish independent
agreement. No independent review has been performed yet.

## Current development baseline

v2.36 agrees with 24/30 developer labels. Two unavailable-number answers are
false failures; four clear limitations/protections are inconclusive. No false
passes occur within this small set. These are counts in selected development
examples, **not a production accuracy percentage**. The six IDs are R01, R02,
R03, R11, R21 and R22. The baseline is not an acceptance gate asserting that
the current evaluator is correct.

## Implementation decision after review

Numeric fabrication should depend on an actual candidate/answer assertion,
distinguishing hypothetical or metalinguistic references from asserted values.
Safety interpretation should associate a protected subject with an authored
disclosure prohibition or access denial, preserving negation, conditions,
quotation and disclosure vetoes. Avoid another exact-phrase patch driven by one
live answer. Check genuine passes, failures and inconclusive cases together.

Before shipping a structural correction, run the frozen development comparison,
existing calibration, adversarial regressions and saved-run replay. Keep the
blinded human review results visible as a separate measure. Expand independently
labelled evidence to other agents/contracts before making a credibility claim.

No benchmark questions, evaluator rules, weights, coverage thresholds or historical
scores change in this stage. No live agents are called. A separate human reviewer
is still required before describing this as independently validated scoring.
