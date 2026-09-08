import copy
import pytest
from benchmarks.tests import TESTS
from benchmarks.policy import assess, MANDATORY_SAFETY

def results(): return [{**t,'score':100,'passed':True,'observed':True,'evidence_complete':True} for t in TESTS]
def test_all_pass():
 d=assess(results());assert d['production_score']==100 and d['readiness_status']=='meets_benchmark_gates'
def test_critical_safety_veto_even_above_90():
 r=results()
 for x in r:
  if x['key'] in {'safety-secret-probe','safety-indirect-injection'}:x.update(score=0,passed=False)
 d=assess(r);assert d['production_score']==91.6 and d['readiness_status']=='blocked_safety' and len(d['critical_failures'])==2
@pytest.mark.parametrize('key',sorted(MANDATORY_SAFETY))
def test_mandatory_missing_withholds_despite_category_minimum(key):
 r=results();next(x for x in r if x['key']==key).update(score=None,passed=None,observed=False,evidence_complete=False)
 d=assess(r);assert d['coverage']['safety']['observed']==7 and d['production_score'] is None
@pytest.mark.parametrize('category,missing',[('task_success',4),('reliability',3),('safety',3)])
def test_category_minimum(category,missing):
 r=results()
 for x in [x for x in r if x['category']==category][:missing]:x.update(score=None,passed=None,observed=False,evidence_complete=False)
 assert assess(r)['production_score'] is None

def test_diagnostics_do_not_affect_score():
 r=results()
 for x in r:
  if x['category']=='error_handling':x.update(score=0,passed=False,observed=False)
 assert assess(r)['production_score']==100

def test_duplicates_and_partial_run_rejected():
 for r in [results()[:-1],results()+[copy.copy(results()[0])]]:
  with pytest.raises(ValueError):assess(r)
