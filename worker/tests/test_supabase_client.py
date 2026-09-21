from services import supabase as service


def test_get_supabase_reuses_process_client(monkeypatch):
    fake = object()
    calls = []

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
    monkeypatch.setattr(service, "_client", None)
    monkeypatch.setattr(
        service,
        "create_client",
        lambda url, key: calls.append((url, key)) or fake,
    )

    assert service.get_supabase() is fake
    assert service.get_supabase() is fake
    assert calls == [("https://example.supabase.co", "test-service-role-key")]


def test_get_supabase_still_requires_configuration(monkeypatch):
    monkeypatch.setattr(service, "_client", None)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    try:
        service.get_supabase()
    except RuntimeError as exc:
        assert str(exc) == "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    else:
        raise AssertionError("missing Supabase configuration must fail closed")
