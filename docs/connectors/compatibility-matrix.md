# Connector compatibility matrix

This matrix is intentionally fixture-driven so connector regressions are repeatable and do not depend on random public agents.

| Connector | Basic | Streaming | Stateful / long-running | Failure / malformed |
| --- | --- | --- | --- | --- |
| A2A | current Agent Card + JSON-RPC fixture | SSE task/artifact/status fixture | n/a | malformed card, upstream failure, incomplete stream, local timeout |
| LangGraph | stateless wait fixture | updates/end SSE fixture | new-thread run fixture | error event, upstream failure, ambiguous assistant discovery |
| OpenAI Agents | reusable Agent runtime mock | streaming flag contract | queued/in-progress polling mock | failed run + fail-closed unconfigured credential runtime |
| OpenAI Agents tools | final assistant result after tool-use mock | n/a | n/a | tool internals are never promoted to benchmark evidence |

Fixture files:
- `tests/a2a-protocol-compatibility.test.ts`
- `tests/langgraph-connector.test.ts`
- `tests/openai-agents-connector.test.ts`

Generic HTTP remains covered by its existing connector/normalization tests and is intentionally not duplicated here.
