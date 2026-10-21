"""Create a scoped research report from verified offline manifests."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from validation.reporting import report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifests', nargs='+')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = report([json.loads(Path(p).read_text()) for p in args.manifests])
    with Path(args.output).open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')
