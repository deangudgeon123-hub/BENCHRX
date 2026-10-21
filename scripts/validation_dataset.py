"""Offline dataset sealing and evaluation. Keep held-out files with a custodian."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from validation.datasets import register, assess_dataset


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    seal = sub.add_parser('seal')
    seal.add_argument('files', nargs='+')
    run = sub.add_parser('evaluate')
    run.add_argument('dataset')
    run.add_argument('--manifest', required=True)
    run.add_argument('--release-held-out', action='store_true')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = register(args.files) if args.command == 'seal' else assess_dataset(
        args.dataset, json.loads(Path(args.manifest).read_text()), release_held_out=args.release_held_out)
    with Path(args.output).open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')


if __name__ == '__main__': main()
