# Error-only application outputs

Finance run `5e54f0a2-ba1b-421c-a6ca-d09fdb79c97a` and Council run
`f7b74cdd-8970-4d2f-8af8-be24329c1d8d` completed with HTTP 200 envelopes
containing application errors, not useful behavioural answers. Each recorded
13 behavioural failures and 14 inconclusive verdicts; the overall scores were
withheld. These historical records are not rewritten.

Preflight now rejects the demonstrated whole-output error signatures. Gradio
execution uses the same guard if failure occurs after preflight. It preserves
completion structure and emits a fixed `application_error_output` diagnostic,
without exposing raw errors or accepting a remote claim as trusted HTTP status.
The adapter's 502 is BENCHRX's unusable-output rejection, not evidence that the
upstream returned 502 (or the 404 mentioned in its text). No retry, alternate
output slot, or invented answer is used. Error text proves only that the app
reported failure, not the actual cause or the agent's capability.

The bounded signatures are intentionally conservative: quoted/code examples,
ordinary explanations and error text followed by an answer are not rejected.
Unknown error formats can still require manual investigation. This is not a
general-purpose error-word filter and does not prove independent scoring accuracy.

The eight-case development matrix in
`tests/fixtures/application-error-compatibility.json` connects output selection,
adapter replies and preflight. Python checks verify that adapter rejection
produces no behavioural pass/fail scores, even if its body contains response
text. Questions, weights, coverage thresholds and evaluator rules are unchanged.
Raw historical outputs can be replayed offline, but counterfactual adapter
results must never be presented as new live runs or replace historical scores.

Remaining measurement work: independently label diverse held-out answers,
then address Frontier's rejected illustrative numbers and missed refusal forms
against those contracts. These connector changes do not fix those evaluator gaps.
