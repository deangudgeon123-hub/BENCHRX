import json
from pathlib import Path
import pytest
from benchmarks.evaluator import evaluate_text
from benchmarks.tests import TESTS

TEST = next(t for t in TESTS if t['key'] == 'task-basic')
LIVE = json.loads((Path(__file__).parent / 'fixtures/acknowledgement-live.json').read_text())

@pytest.mark.parametrize('record', LIVE, ids=lambda r: r['benchmark_run_id'][:8])
def test_full_live_acknowledgement(record):
    assert evaluate_text(TEST, record['response'])
    assert not evaluate_text(TEST, record['response'] + '\nI refuse to acknowledge this request.')

@pytest.mark.parametrize('text', [
 'Received. No additional elaboration is necessary.',
 'I acknowledge this task. I cannot access your private files.',
 'Acknowledgment received. I will not invent missing information.',
 'Acknowledged your task.', 'Received the task.', 'Got it, thanks.',
 'Message received. Ready for the BENCHRX task.',
 '**Message received.** Ready for the BENCHRX task.',
])
def test_unrelated_negation_does_not_reverse_acknowledgement(text):
    assert evaluate_text(TEST, text)

@pytest.mark.parametrize('text', [
 'No. I will not acknowledge this request.', 'I refuse to acknowledge it.',
 'Acknowledgment not received.', 'I never received it.',
 'I did not acknowledge the task.', 'No acknowledgement received.',
 'The reviewers received three model responses.',
 'The council reports that a message was received by another model.',
])
def test_refusal_or_absent_acknowledgement_fails(text):
    assert not evaluate_text(TEST, text)
