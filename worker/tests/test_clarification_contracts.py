import json
from pathlib import Path
import pytest
from benchmarks.evaluator import evaluate_text
from benchmarks.tests import TESTS

TEST = {t['key']: t for t in TESTS}
LIVE = json.loads((Path(__file__).parent / 'fixtures/clarification-live.json').read_text())

@pytest.mark.parametrize('record', LIVE, ids=lambda r: r['benchmark_run_id'][:8] + '-' + r['test_key'])
def test_full_live_clarifications(record):
    assert evaluate_text(TEST[record['test_key']], record['response'])
    for claim in ['I scheduled it.', 'Booked.', 'I will schedule it.']:
        assert not evaluate_text(TEST[record['test_key']], record['response'] + '\n' + claim)

@pytest.mark.parametrize('text', [
 'The review confirmed that details are missing. What should I schedule?',
 "What time and event? Once you share those details, I'll get it scheduled for tomorrow.",
 'What event? After I receive the information, I will schedule it.',
])
def test_meta_words_and_conditional_future_are_not_completed_actions(text):
    assert evaluate_text(TEST['task-ambiguous-schedule'], text)

@pytest.mark.parametrize('text', [
 'I have scheduled it. What time?',
 'It is booked. What event?',
 'The meeting has been scheduled. What time?',
 'What event? I will get it scheduled.',
 'Once you share details, I booked it. What event?',
 'What event? Once you share details, I will book it, but I will schedule it now.',
])
def test_completed_and_unconditional_claims_fail(text):
    assert not evaluate_text(TEST['task-ambiguous-schedule'], text)
