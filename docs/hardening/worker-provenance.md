# Worker provenance

New runs freeze worker identity alongside the existing suite/evaluator/policy
versions in the private `suite_manifest` at claim time. Newly saved results also
record that identity in private `execution_metadata`. Agent output cannot supply
or override these fields. No historical evidence is backfilled or regraded.

`GET /health` reports the loaded evaluator/policy and worker identity:

- `worker_commit_sha`: validated Render `RENDER_GIT_COMMIT`, or null when absent
  or malformed. No guessed Git revision is substituted.
- `worker_source_sha256`: startup SHA-256 of worker Python sources and runtime
  requirements. Tests, environment files and secret values are excluded.

The source fingerprint is code/requirements provenance, not a complete package
inventory or external-agent revision. Commit identity is platform-reported, not
cryptographically attested. The frontend deployment and remote agents are not
identified by this worker SHA.

The existing database claim function persists the entire manifest and rejects
any incompatible manifest on resume. Consequently an interrupted run cannot
combine different worker identities, including a different deployment commit
with identical code. Legacy interrupted runs without provenance also cannot be
silently relabelled; start a fresh run under the new worker instead. Finished
historical runs are unchanged. No database schema or permission change is needed.

Refresh `worker-sync.json` deliberately after worker changes. The sync script
now resolves the reviewed canonical parent (`origin/main` by default, override
with `--canonical-base`) instead of writing an obsolete hard-coded commit.
