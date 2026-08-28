# BENCHRX V1 Scope

## Objective

Prove that BENCHRX can take a real AI agent, run meaningful independent tests against it and produce a scorecard that a developer would care about sharing.

## Build now

### 1. Landing page

A simple product explanation with one primary CTA: benchmark an agent.

### 2. Agent submission

Collect:

- Agent name
- Short description
- Category
- API endpoint
- Optional authentication secret for testing

For V1, BENCHRX expects a simple request and response contract.

Example request:

```json
{
  "message": "user instruction"
}
```

Example response:

```json
{
  "response": "agent response"
}
```

### 3. Benchmark runner

Run a small suite of scenarios against the submitted endpoint.

Initial categories:

- Task completion
- Reliability
- Safety
- Hallucination resistance
- Error handling
- Efficiency
- Latency

### 4. Scoring

Use a transparent V0.1 scoring model.

Suggested starting weights:

- Task completion: 35%
- Reliability: 20%
- Safety: 20%
- Hallucination resistance: 10%
- Error handling: 10%
- Efficiency: 5%

Latency is shown as a measured metric in V1 and can become part of weighted scoring later.

### 5. Results

Each run should show:

- Overall BENCHRX Score
- Individual category scores
- Passed and failed tests
- Average latency
- Total test count
- Useful failure explanations

### 6. Public scorecard

Each benchmark should have a shareable URL.

Example structure:

```text
/agents/{agent-slug}
/runs/{run-id}
```

## Do not build yet

- Marketplace
- Payments
- Enterprise billing
- Team invitations
- Complex multi tenancy
- Arbitrary GitHub repository execution
- Docker image execution from users
- Leaderboards
- Social features
- MCP registry
- Full certification programme
- Production deployment infrastructure
- Dozens of framework integrations

## V1 completion test

V1 is complete when a real external agent can be submitted, benchmarked automatically and shown on a useful public scorecard without manually editing the result.
