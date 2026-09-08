from services.redaction import known_secrets,redact

def test_endpoint_nested_credentials_and_env_secrets_are_removed(monkeypatch):
    monkeypatch.setenv('BENCHMARK_API_SECRET','internal-known-secret')
    endpoint='https://benchrx.example/api/adapters/generic?fixedBody=%7B%22api_key%22%3A%22provider-key-1234%22%7D'
    values=known_secrets(endpoint)
    assert 'provider-key-1234' in values
    original={'body':{'response':'internal-known-secret provider-key-1234 Authorization: Bearer unknown-token','api_key':'another-secret'}}
    scrubbed=redact(original,values)
    assert scrubbed['body']['api_key']=='[REDACTED]'
    for secret in ['internal-known-secret','provider-key-1234','unknown-token','another-secret']:assert secret not in str(scrubbed)
    assert 'internal-known-secret' in original['body']['response']
