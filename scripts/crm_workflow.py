"""JSON-lines tool bridge. Connect a trusted agent driver to stdin/stdout."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from validation.workflows import CRMEnvironment, TASKS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('task', choices=sorted(TASKS))
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    # Reserve output before any interaction, refusing to overwrite old evidence.
    with Path(args.output).open('x') as output:
        environment = CRMEnvironment(args.task)
        print(json.dumps(environment.description()), flush=True)
        report = None
        for line in sys.stdin:
            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError('Request must be an object')
            except (ValueError, TypeError):
                environment.call('invalid_request', {})
                report = environment.finish(complete=False)
                break
            if request.get('operation') == 'finish':
                report = environment.finish(request.get('response', ''))
                break
            result = environment.call(request.get('operation'), request.get('arguments'))
            print(json.dumps(result), flush=True)
            if result.get('error') == 'call_limit':
                report = environment.finish(complete=False)
                break
        if report is None:
            report = environment.finish(complete=False)
        json.dump(report, output, indent=2)
        output.write('\n')
        print(json.dumps({'operational_verdict': report['operational_verdict'],
                          'evidence_sha256': report['evidence_sha256']}), flush=True)


if __name__ == '__main__': main()
