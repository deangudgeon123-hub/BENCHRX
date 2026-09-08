"""Check frozen worker file hashes locally or against another Git ref.

Update deliberately with --write after reviewed worker changes. Compare the Render
branch with --compare origin/feature/generic-connector-reliability after fetching.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'docs/hardening/worker-sync.json'
parser = argparse.ArgumentParser()
parser.add_argument('--write', action='store_true')
parser.add_argument('--compare')
args = parser.parse_args()
paths = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / 'worker').rglob('*')
               if p.is_file() and (p.suffix == '.py' or p.name.startswith('requirements')))
if args.write:
    MANIFEST.write_text(json.dumps({
        'canonical_base': 'c505b21550ec6e244513adab072f8ae68ff84306',
        'files': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths},
    }, indent=2) + '\n')
    print(f'Recorded {len(paths)} worker file hashes')
    raise SystemExit(0)
expected = json.loads(MANIFEST.read_text())['files']
errors = []
if not args.compare and set(paths) != set(expected):
    errors.append('Worker file inventory differs from manifest')
for path, digest in expected.items():
    try:
        data = subprocess.check_output(['git', 'show', f'{args.compare}:{path}'], cwd=ROOT, stderr=subprocess.DEVNULL) if args.compare else (ROOT / path).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            errors.append(path)
    except (OSError, subprocess.CalledProcessError):
        errors.append(path + ' (missing)')
if errors:
    print('Worker drift detected:\n' + '\n'.join(errors))
    raise SystemExit(1)
print(f'Worker sync verified: {len(expected)} files')
