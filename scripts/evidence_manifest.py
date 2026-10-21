"""Export/replay permitted local evidence without contacting production systems."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from validation.evidence import manifest, replay


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    export = sub.add_parser('export')
    export.add_argument('kind', choices=['validation_cases', 'crm_workflow', 'saved_score_rows'])
    export.add_argument('input')
    export.add_argument('--agent-id', required=True)
    export.add_argument('--captured-at', required=True)
    export.add_argument('--limitation', action='append', default=[])
    export.add_argument('--parent')
    export.add_argument('--correction-reason')
    check = sub.add_parser('replay')
    check.add_argument('input')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    data = json.loads(Path(args.input).read_text())
    if args.command == 'replay':
        result = replay(data)
    else:
        parent = json.loads(Path(args.parent).read_text()) if args.parent else None
        result = manifest(args.kind, data, agent_configuration_id=args.agent_id,
                          captured_at=args.captured_at, limitations=args.limitation,
                          parent=parent, correction_reason=args.correction_reason)
    with Path(args.output).open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')


if __name__ == '__main__': main()
