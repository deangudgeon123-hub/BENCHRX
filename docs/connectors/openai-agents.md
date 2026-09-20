# OpenAI Agents connector

BENCHRX now has a first-class provider boundary for the current OpenAI Agents platform: reusable Agent IDs, streamed/non-streamed execution, long-running run polling, failures and assistant-authored final output are represented by the connector contract and covered by mocks.

Live hosted execution is intentionally **not enabled yet**. BENCHRX does not currently have a per-connection private credential store suitable for a user's OpenAI project credential. API keys must never be placed in endpoint URLs, query strings, logs, public database fields or browser-visible payloads.

The remaining enablement requirement is a private server-side credential binding (for example, encrypted workspace-scoped secrets resolved only inside the adapter). Once that exists, the production runtime can bind the current OpenAI Agents API Sessions/Events/Turns surface behind `OpenAIAgentsRuntime` without changing benchmark scoring or trusted evidence semantics.

Do not substitute the legacy Assistants API for this connector.
