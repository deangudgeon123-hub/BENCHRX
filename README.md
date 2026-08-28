# BENCHRX

**Independent production testing for AI agents.**

BENCHRX is a platform for benchmarking AI agents before they are trusted with real business systems.

The goal is simple: give developers and companies an independent, repeatable way to understand whether an agent is reliable, safe, efficient and ready for production.

## The problem

AI agents are increasingly being connected to real systems such as CRMs, inboxes, payment platforms, databases, internal tools and codebases.

But an agent looking good in a demo does not prove that it will behave reliably in production.

Teams need answers to questions like:

- Does the agent actually complete the task correctly?
- Does it behave consistently across repeated runs?
- Does it respect permissions and boundaries?
- Can it recover when tools or APIs fail?
- Can it resist malicious or misleading instructions?
- How much does a successful task cost?
- How long does it take?

BENCHRX is being built to answer those questions with independent benchmark runs and clear scorecards.

## V1

The first version is intentionally small.

A developer submits an agent endpoint. BENCHRX runs a benchmark suite against it, evaluates the results and generates a public scorecard.

Initial flow:

```text
Submit agent
    ↓
Run benchmark scenarios
    ↓
Evaluate responses and behaviour
    ↓
Calculate scores
    ↓
Publish shareable scorecard
```

Initial benchmark areas:

- Task completion
- Reliability
- Safety
- Hallucination resistance
- Error handling
- Efficiency
- Latency

## Proposed V1 stack

### Web application

- Next.js
- TypeScript
- Tailwind CSS
- Vercel

### Data

- Supabase
- PostgreSQL

### Benchmark service

- Python
- FastAPI
- pytest
- DeepEval
- Inspect AI where useful

### Execution

V1 will benchmark controlled API endpoints rather than execute arbitrary user supplied repositories.

This keeps the first version simpler and safer while the core benchmark experience is validated.

## V1 success condition

The first technical proof is complete when BENCHRX can:

1. Accept a real agent endpoint
2. Run a repeatable benchmark suite
3. Store the benchmark results
4. Calculate useful scores
5. Produce a public result page
6. Explain exactly which tests passed and failed

The goal is not to build the whole platform at once.

**Build the proof before the empire.**

## Longer term direction

If the core benchmark proves valuable, BENCHRX can expand into:

- Category specific benchmark suites
- Version regression testing
- Public agent profiles
- Verified badges
- Agent rankings
- Production certification
- Private team benchmarks
- Enterprise assurance and governance
- Agent registry and discovery
- Deployment and marketplace infrastructure

## Status

Early development.

The immediate priority is the V1 benchmark engine and scorecard experience.

<!-- deployment trigger: 2026-08-28 -->
