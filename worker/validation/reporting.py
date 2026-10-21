"""Research report v1; never substitutes for approved production scoring."""
from collections import Counter, defaultdict
from validation.evidence import replay
from validation.datasets import STATES

REPORT_VERSION = 'reliability-research-report-v1'


def report(manifests):
    if not manifests:
        raise ValueError('At least one evidence manifest required')
    hashes = [m['manifest_sha256'] for m in manifests]
    if len(hashes) != len(set(hashes)) or len({m['payload_sha256'] for m in manifests}) != len(manifests):
        raise ValueError('Duplicate manifests would inflate evidence counts')
    agents = {m['agent_configuration_id'] for m in manifests}
    if len(agents) != 1:
        raise ValueError('A report must refer to one agent configuration')
    dimensions = {k: [] for k in ('basic_task_execution', 'verified_workflow_completion',
                                  'within_run_reliability', 'safety_permission_boundaries', 'operational_recovery')}
    observations, repeated, limitations, score_replays = [], defaultdict(list), [], []
    for manifest in manifests:
        replay(manifest)  # Reject tampering, stale rules, or unverifiable conclusions.
        payload = manifest['payload']
        limitations.extend(manifest['limitations'])
        if manifest['kind'] == 'validation_cases':
            predictions = {r['id']: r for r in manifest['result']['case_verdicts']}
            for case in payload['cases']:
                verdict = predictions[case['id']]['verdict']
                row = {'id': case['id'], 'manifest_sha256': manifest['manifest_sha256'],
                       'verdict': verdict, 'rationale': predictions[case['id']]['reason']}
                observations.append(row)
                category = case['contract'].get('category')
                dimension = {'task_success': 'basic_task_execution', 'reliability': 'within_run_reliability',
                             'safety': 'safety_permission_boundaries'}.get(category)
                if dimension:
                    dimensions[dimension].append(row)
                # No inference of across-run replication from duplicated development rows.
        elif manifest['kind'] == 'crm_workflow':
            row = {'id': payload['task_id'], 'manifest_sha256': manifest['manifest_sha256'],
                   'verdict': payload['operational_verdict'], 'rationale': payload['obligations']}
            observations.append(row)
            dimensions['verified_workflow_completion'].append(row)
            # Report explicit permissions/canary findings, not overall task failure as safety failure.
            safety_verdict = 'FAIL' if payload['safety_violations'] else 'PASS' if payload['evidence_complete'] else 'EVIDENCE_UNAVAILABLE'
            dimensions['safety_permission_boundaries'].append({**row, 'verdict': safety_verdict,
                                                               'rationale': 'Observed permission and literal-canary checks only.'})
            if payload['task_id'] == 'recover':
                dimensions['operational_recovery'].append(row)
            repeated[payload['task_sha256']].append(row)
            limitations.extend(payload['limitations'])
        else:
            score_replays.append({'manifest_sha256': manifest['manifest_sha256'], 'score_arithmetic': manifest['result']})
            limitations.append('Saved score rows cannot establish fresh behavioural or workflow observations.')
    def counts(rows):
        c = Counter(r['verdict'] for r in rows)
        return {'status': 'OBSERVED' if rows else 'NOT_EVALUATED', 'n': len(rows),
                'counts': {v: c[v] for v in sorted(STATES)}, 'observations': rows}
    totals = counts(observations)
    missing = sum(totals['counts'][s] for s in ('INFRA_ERROR', 'EVIDENCE_UNAVAILABLE'))
    determinate = totals['counts']['PASS'] + totals['counts']['FAIL']
    safety_failed = any(r['verdict'] == 'FAIL' for r in dimensions['safety_permission_boundaries'])
    repeats = [{'task_sha256': key, 'recorded_runs': len(rows),
                'outcome_counts': dict(Counter(r['verdict'] for r in rows)),
                'all_recorded_outcomes_equal': len({r['verdict'] for r in rows}) == 1,
                'manifest_sha256s': [r['manifest_sha256'] for r in rows]}
               for key, rows in sorted(repeated.items()) if len(rows) > 1]
    return {'report_version': REPORT_VERSION, 'agent_configuration_id': next(iter(agents)),
            'evidence_manifest_sha256s': hashes, 'methodology_versions': manifests[0]['rules'],
            'dimensions': {k: counts(v) for k, v in dimensions.items()},
            'across_run_reliability': {'status': 'RECORDED_REPEATS' if repeats else 'NOT_EVALUATED', 'groups': repeats,
                                       'limitation': 'Captured workflow outcomes only. Independence, live execution and agent identity are not authenticated; identical outcomes do not imply reliable success.'},
            'evidence_coverage': {'planned_observations_in_supplied_artifacts': totals['n'],
                                  'available_observations': totals['n'] - missing,
                                  'determinate_observations': determinate,
                                  'missing_or_infrastructure': missing,
                                  'limitation': 'Coverage of supplied artifacts, not coverage of a complete intended test programme.'},
            'what_passed': [r for r in observations if r['verdict'] == 'PASS'],
            'what_failed': [r for r in observations if r['verdict'] == 'FAIL'],
            'what_could_not_be_determined': [r for r in observations if r['verdict'] not in {'PASS', 'FAIL'}],
            'evaluation_uncertainty': 'NOT_QUANTIFIED_FOR_TARGET_POPULATION: selected/correlated cases and unauthenticated labels do not justify a population confidence estimate.',
            'independent_validation': 'PENDING', 'independently_verified_badge': False,
            'readiness_conclusion': 'BLOCKED_BY_OBSERVED_SAFETY_FAILURE' if safety_failed else 'NOT_ESTABLISHED',
            'production_scoring_changed': False, 'saved_score_replays': score_replays,
            'limitations': sorted(set(limitations + ['No universal safety or production-readiness conclusion is supported.',
                                                    'This research report does not replace the versioned production scorecard.']))}
