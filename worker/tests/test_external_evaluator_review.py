"""Fabricated labels here test plumbing only, never independent validation."""
import copy
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import external_evaluator_review as review


@pytest.fixture
def packet(tmp_path):
    root = review.prepare(tmp_path / 'packet')
    return root


def submissions(root):
    template = json.loads((root / 'reviewer/submission-template.json').read_text())
    paths = []
    for number in range(2):
        submission = copy.deepcopy(template)
        submission.update(reviewer_id=f'SYNTHETIC-TEST-{number}', review_date='2026-01-01',
                          conflicts_of_interest='Software test fixture, not a human review',
                          human_reviewer=False, did_not_author_or_tune_evaluator=False,
                          not_exposed_to_labels_predictions_or_other_reviews=False)
        for i, row in enumerate(submission['verdicts']):
            row.update(verdict=review.VERDICTS[(i+number) % 3], rationale='Synthetic plumbing assertion only')
        path = root / f'test-{number}.json'
        review.write_json(path, submission)
        paths.append(path)
    return paths


def test_blind_packet_only_contains_unlabelled_evidence(packet):
    public = json.loads((packet / 'reviewer/packet.json').read_text())
    private = json.loads((packet / 'coordinator.json').read_text())
    assert len(public['cases']) == 30
    assert set(p.name for p in (packet / 'reviewer').iterdir()) == {'packet.json', 'submission-template.json'}
    assert all(set(row) == {'id', 'prompt', 'contract', 'response'} for row in public['cases'])
    assert not any(row['id'].startswith('R') for row in public['cases'])
    assert review.digest(public) == private['packet_sha256']
    assert not any(word in json.dumps(public) for word in ('deterministic-v', '"expected":', '"actual":'))


def test_prepare_never_overwrites(packet):
    with pytest.raises(FileExistsError):
        review.prepare(packet)


def test_metrics_known_confusion_and_undefined_kappa():
    result = review.comparison(dict(a='FAIL', b='PASS', c='FAIL'),
                               dict(a='PASS', b='FAIL', c='INDETERMINATE'))
    assert result['matched'] == 0
    assert result['false_pass'] == result['false_fail'] == result['incorrect_indeterminate'] == 1
    assert review.comparison({'a': 'PASS'}, {'a': 'PASS'})['cohens_kappa'] is None
    perfect = review.comparison({'a': 'PASS', 'b': 'FAIL'}, {'a': 'PASS', 'b': 'FAIL'})
    assert perfect['cohens_kappa'] == 1
    assert perfect['agreement_wilson_95_conditional'][0] < 1


def test_two_reviewers_disagreements_and_originals_preserved(packet):
    paths = submissions(packet)
    before = [p.read_bytes() for p in paths]
    result = review.analyse(packet, paths)
    assert len(result['disagreements']) == 30
    assert result['reviewer_pairs'][0]['metrics']['matched'] == 0
    assert len(result['reviewer_vs_benchrx']) == 2
    assert result['independent_validation'] is False
    assert result['validation_status'].startswith('PENDING')
    assert [p.read_bytes() for p in paths] == before
    assert result['reviews'][0]['original'] == json.loads(before[0])
    assert result['evaluator_version'] == 'deterministic-v2.37'


@pytest.mark.parametrize('mutation', ['missing', 'duplicate', 'bad_label', 'blank_rationale', 'wrong_hash', 'blank_identity', 'blank_coi', 'no_attestation', 'future_date', 'same_reviewer'])
def test_invalid_submissions_fail_closed(packet, mutation):
    paths = submissions(packet)
    obj = json.loads(paths[1].read_text())
    if mutation == 'missing': obj['verdicts'].pop()
    if mutation == 'duplicate': obj['verdicts'][-1] = obj['verdicts'][0]
    if mutation == 'bad_label': obj['verdicts'][0]['verdict'] = 'INFRA_ERROR'
    if mutation == 'blank_rationale': obj['verdicts'][0]['rationale'] = ' '
    if mutation == 'wrong_hash': obj['packet_sha256'] = 'bad'
    if mutation == 'blank_identity': obj['reviewer_id'] = ' '
    if mutation == 'blank_coi': obj['conflicts_of_interest'] = ''
    if mutation == 'no_attestation': obj['human_reviewer'] = None
    if mutation == 'future_date': obj['review_date'] = '9999-01-01'
    if mutation == 'same_reviewer': obj['reviewer_id'] = 'synthetic-test-0'
    paths[1].write_text(json.dumps(obj))
    with pytest.raises(ValueError): review.analyse(packet, paths)


def test_requires_two_reviewers(packet):
    with pytest.raises(ValueError, match='two'):
        review.analyse(packet, submissions(packet)[:1])


def test_tampering_fails_even_if_packet_hash_recomputed(packet):
    path = packet / 'reviewer/packet.json'
    obj = json.loads(path.read_text())
    obj['cases'][0]['response'] = 'tampered'
    path.write_text(json.dumps(obj))
    coordinator_path = packet / 'coordinator.json'
    coordinator = json.loads(coordinator_path.read_text())
    coordinator['packet_sha256'] = review.digest(obj)
    coordinator_path.write_text(json.dumps(coordinator))
    with pytest.raises(ValueError, match='frozen'): review.load_packet(packet)


def test_no_developer_labels_loaded(packet, monkeypatch):
    import evaluator_review
    monkeypatch.setattr(evaluator_review, 'LABELS', Path('/does/not/exist'))
    assert review.analyse(packet, submissions(packet))['case_sha256'] == review.CASE_SHA


def test_duplicate_json_fields_are_rejected():
    with pytest.raises(ValueError, match='Duplicate JSON'):
        review.parse_json('{"verdict":"FAIL","verdict":"PASS"}')
