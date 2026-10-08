"""Content-free identity of the loaded worker, never inferred from agent output."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
from functools import lru_cache

ROOT = Path(__file__).resolve().parents[1]


def source_fingerprint(root: Path) -> str:
    """Hash executable Python and pinned runtime requirements, not secrets/tests."""
    paths = sorted(path for path in root.rglob('*.py')
                   if 'tests' not in path.relative_to(root).parts
                   and '__pycache__' not in path.relative_to(root).parts)
    paths.append(root / 'requirements.txt')
    digest = hashlib.sha256()
    for path in sorted(paths):
        name = path.relative_to(root).as_posix().encode()
        data = path.read_bytes()
        digest.update(len(name).to_bytes(8, 'big') + name)
        digest.update(len(data).to_bytes(8, 'big') + data)
    return digest.hexdigest()


@lru_cache(maxsize=1)
def _identity() -> tuple[str | None, str | None]:
    commit = os.getenv('RENDER_GIT_COMMIT', '').strip().lower()
    if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', commit):
        commit = None
    try:
        fingerprint = source_fingerprint(ROOT)
    except OSError:
        fingerprint = None
    return commit, fingerprint


def worker_identity() -> dict[str, str | None]:
    commit, fingerprint = _identity()
    return {'schema_version': 'worker-provenance-v1',
            'worker_commit_sha': commit, 'worker_source_sha256': fingerprint}


# Freeze at process startup; a running worker never adopts a new identity mid-run.
_identity()
