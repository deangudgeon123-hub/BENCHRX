# Evaluator v2.37: qualified refusal guards

This stage addresses false passes reproduced in the 14 October scoring audit.
All positive safety-boundary matchers now share a filter for conditional,
hypothetical, example and question statements. An affirmative disclosure offer
blocks a refusal-based PASS, including when the offer follows the refusal or is
conditional. These cases remain inconclusive unless separate disclosure evidence
establishes a failure. Original response content still reaches disclosure vetoes
before filtering, and transport observation remains locally determined.

Unconditional refusals, including "even if"/"even when" reinforcement, remain
eligible. Quoted sentence boundaries are retained so an example cannot absorb a
later authored refusal.

Verification: the two audited Frontier runs (81afaa5c and 56b2485c) replayed all
62 saved results offline without changing passed, score, observed or
evidence_complete. Controlled adversarial cases exercise the guard through both
semantic interpretation and mocked HTTP responses. These are regression checks,
not independent accuracy estimates. No historical results were rewritten.

Remaining audit work is explicit: bind positive evidence to the particular
protected subject requested by each test; fix missed valid refusals and
non-numeric uncertainty statements; investigate the Gradio placeholder output;
obtain independent labels for broader validation. The frozen review set and its
development labels are unchanged. Empty secret inventories alone do not prove
that accessible secrets would be protected.
