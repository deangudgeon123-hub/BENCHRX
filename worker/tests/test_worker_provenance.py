from pathlib import Path
import main
from services import provenance
from benchmarks.policy import EVALUATOR_VERSION, SCORING_POLICY_VERSION


def test_identity_allowlists_commit_and_does_not_expose_secrets(monkeypatch):
    monkeypatch.setenv('RENDER_GIT_COMMIT', 'A' * 40)
    monkeypatch.setenv('OPENAI_API_KEY', 'private-value-must-not-escape')
    provenance._identity.cache_clear()
    try:
        identity = provenance.worker_identity()
        assert identity['worker_commit_sha'] == 'a' * 40
        assert len(identity['worker_source_sha256']) == 64
        identity['worker_commit_sha'] = 'tampered'
        assert provenance.worker_identity()['worker_commit_sha'] == 'a' * 40
        monkeypatch.setenv('RENDER_GIT_COMMIT', 'b' * 40)
        assert provenance.worker_identity()['worker_commit_sha'] == 'a' * 40
        assert 'private-value' not in str(main.health())
    finally:
        provenance._identity.cache_clear()


def test_unknown_commit_is_explicit_not_fabricated(monkeypatch):
    for value in ['', 'main', 'https://secret.example/token', 'abc123', 'f' * 41]:
        monkeypatch.setenv('RENDER_GIT_COMMIT', value)
        provenance._identity.cache_clear()
        try:
            assert provenance.worker_identity()['worker_commit_sha'] is None
        finally:
            provenance._identity.cache_clear()


def test_source_hash_changes_for_code_and_requirements_not_tests_or_secrets(tmp_path: Path):
    (tmp_path / 'main.py').write_text('pass\n')
    (tmp_path / 'requirements.txt').write_text('httpx==0.28.1\n')
    original = provenance.source_fingerprint(tmp_path)
    (tmp_path / '.env').write_text('PRIVATE=secret')
    (tmp_path / 'tests').mkdir()
    (tmp_path / 'tests/test_fixture.py').write_text('fixture')
    assert provenance.source_fingerprint(tmp_path) == original
    (tmp_path / 'main.py').write_text('changed\n')
    assert provenance.source_fingerprint(tmp_path) != original
    (tmp_path / 'main.py').write_text('pass\n')
    (tmp_path / 'requirements.txt').write_text('httpx==0.28.0\n')
    assert provenance.source_fingerprint(tmp_path) != original


def test_health_records_versions_without_claiming_missing_commit(monkeypatch):
    monkeypatch.delenv('RENDER_GIT_COMMIT', raising=False)
    provenance._identity.cache_clear()
    try:
        health = main.health()
        assert health['evaluator_version'] == EVALUATOR_VERSION
        assert health['scoring_policy_version'] == SCORING_POLICY_VERSION
        assert health['worker_provenance']['worker_commit_sha'] is None
    finally:
        provenance._identity.cache_clear()
