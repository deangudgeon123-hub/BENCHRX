# BENCHRX methodology: implementation and limits

Status as prepared on 2026-10-21: internal software tooling exists; genuine
external evaluator validation, external held-out data, live controlled-workflow
agent trials and formal accreditation are PENDING/not established.

The intended standard is evidence-backed, versioned and reproducible evaluation.
We do not yet claim that all BENCHRX conclusions satisfy independent validation.

| Component | Implemented scope | What remains |
| --- | --- | --- |
| External review | Blinded frozen-case packets, structured submissions, agreement analysis | Genuine reviewers, conflict/authenticity checks, completed findings |
| Dataset framework | Versioned partitions, hashes, grouped leakage checks, five-state analysis | Broad real-world observations, independent labels, restricted held-out custody |
| Operational testing | Local synthetic CRM, captured tools and full-state verification | Remote agent adapter/containment and actual agent trials |
| Reproducibility | Offline manifests and replay, correction links | Approved production export integration and external reproduction |
| Reliability reporting | Separate research dimensions and explicit limitations | Validated/approved production scorecard changes |
| Independence | Proposed charter and review process | Organisational adoption, review appointments and governance records |

Production benchmark suite 2.0, policy behavioural-v2.2 and evaluator
deterministic-v2.37 remain unchanged by this programme. A score from a limited
conversational benchmark must not be represented as universal safety or readiness.

Start with the [independence charter](independence-charter.md) and
[independent review process](independent-review-process.md). Technical workflows:

* [External review](../hardening/external-review-workflow.md)
* [Validation datasets](../hardening/validation-datasets.md)
* [Controlled CRM](../hardening/crm-workflows.md)
* [Evidence and replay](../hardening/evidence-replay.md)
* [Research reporting](../hardening/reliability-reporting.md)

Automated tests verify implementation behaviour. They cannot establish that
reference labels are correct, that the samples represent deployed agents, that
reviewers are independent, or that live production systems are reliable.

See the [implementation verification report](../hardening/independent-programme-verification.md) for staged commits, automated test results and remaining blockers.
