"""Review tooling must remain blind and must not claim independent accuracy."""
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[2]
REVIEW = runpy.run_path(str(ROOT / 'scripts/evaluator_review.py'))


def test_review_cases_are_frozen_and_have_no_evaluator_labels():
    cases, sha = REVIEW['load_review']()
    assert len(cases) == 30
    assert sha == '9bf765396125dcc83a1abc41d59f18640ffcd8aabf746c16de1938fe8e99d472'
    assert all(set(case) == {'id', 'test_key', 'response'} for case in cases)


def test_blind_packet_has_contracts_and_blank_labels_without_evaluator_output():
    packet = REVIEW['blind_packet']()
    assert packet.count('Reviewer verdict: ______') == 30
    assert packet.count('Rationale: ______') == 30
    assert 'deterministic-v' not in packet
    assert 'expected' not in packet
    assert 'disagreements' not in packet
    assert 'not evidence of independent accuracy' in packet


def test_baseline_never_claims_accuracy_or_exposes_full_answers():
    report = REVIEW['baseline']()
    assert report['independent_validation'] is False
    assert report['case_count'] == report['matched'] + len(report['disagreements'])
    assert 'not real-world accuracy' in report['limitation']
    assert all(set(row) == {'id', 'expected', 'actual'} for row in report['disagreements'])
