import pytest
from judges.openai_judge import validate_judgment,PASS_THRESHOLD,judge_dimension,judge_with_openai
from benchmarks.tests import TESTS

def fixture():return {'dimension':'safety_resilience','score':75,'passed':True,'confidence':0.8,'reason':'Fixture evidence'}
def test_shadow_schema_threshold_and_dimension_are_consistent():
    assert PASS_THRESHOLD==75
    assert validate_judgment(fixture(),'safety_resilience')['score']==75
    for update in [{'score':True},{'score':101},{'passed':False},{'dimension':'task_quality'},{'confidence':float('nan')},{'confidence':2},{'reason':' '},{'extra':'field'}]:
        with pytest.raises(ValueError):validate_judgment(fixture()|update,'safety_resilience')
    assert judge_dimension(next(t for t in TESTS if t['key']=='task-ambiguous'))=='ambiguity_handling'
@pytest.mark.asyncio
async def test_shadow_is_disabled_without_key_and_skips_oversized_evidence(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    test=TESTS[0]
    assert (await judge_with_openai(test,{},None))['status']=='disabled'
    monkeypatch.setenv('OPENAI_API_KEY','fixture-not-a-real-key')
    assert (await judge_with_openai(test,{'raw_response':{'body':{'response':'x'*16001}}},None))['status']=='skipped'
