import test from 'node:test';
import assert from 'node:assert/strict';
import {behaviouralEvidenceSummary, comparableRuns, diagnosticSummary, readinessLabel, withholdingReason} from '../lib/measurement-view.ts';
const current={suite_version:'2.0',scoring_policy_version:'behavioural-v2.2',evaluator_version:'deterministic-v2.25'};
test('withholding distinguishes inconclusive replies from missing usable responses without rewriting gates',()=>{
 const rows = [
  {passed:null,score:null,raw_response:{observed:true,outcome_type:'inconclusive'},test_cases:{key:'safety-secret-probe'}},
  {passed:null,score:null,raw_response:{observed:false,outcome_type:'unobserved'},test_cases:[{key:'task-basic'}]},
 ];
 assert.equal(withholdingReason('Missing mandatory observation: safety-secret-probe',rows),'Response received, but no conclusive verdict: safety-secret-probe');
 assert.equal(withholdingReason('Missing complete behavioural observation: task-basic',rows),'No usable behavioural response: task-basic');
 assert.equal(withholdingReason('Missing mandatory observation: absent',rows),'Missing mandatory observation: absent');
 assert.equal(withholdingReason('safety: insufficient category coverage',rows),'safety: insufficient category coverage');
 assert.equal(behaviouralEvidenceSummary([...rows,{passed:false,score:0,raw_response:null},{passed:true,score:100,raw_response:null}]),'2 conclusive checks · 1 responses inconclusive · 1 without usable behavioural responses');
 assert.equal(rows[0].raw_response.outcome_type,'inconclusive');
});
test('A2A repeated help replies remain inconclusive, not connection failures or safety passes',()=>{
 const rows=Array.from({length:27},(_,i)=>({passed:i<13?false:null,score:i<13?0:null,raw_response:{observed:true,outcome_type:i<13?'agent_fail':'inconclusive'}}));
 assert.equal(behaviouralEvidenceSummary(rows),'13 conclusive checks · 14 responses inconclusive · 0 without usable behavioural responses');
});
test('inapplicable or inconclusive diagnostics are not counted as failures',()=>{
 assert.equal(diagnosticSummary([{passed:null},{passed:null},{passed:null},{passed:null}]),'Not evaluated');
 assert.equal(diagnosticSummary([{passed:true},{passed:false},{passed:null}]),'1/2 passed · 1 not evaluated');
 assert.equal(diagnosticSummary([{passed:false},{passed:false}]),'0/2 passed');
 assert.equal(diagnosticSummary([{passed:true}]),'1/1 passed');
 assert.equal(diagnosticSummary([]),'Not evaluated');
});
test('only compatible recorded versions have deltas',()=>{
 assert.equal(comparableRuns(current,{...current}),true);
 for(const old of [{}, {...current,suite_version:'1.0'}, {...current,scoring_policy_version:'behavioural-v2.1'}, {...current,scoring_policy_version:'legacy-unversioned'},null]) assert.equal(comparableRuns(current,old),false);
 assert.equal(comparableRuns({...current,scoring_policy_version:'behavioural-v2.1'},{...current,scoring_policy_version:'behavioural-v2.1'}),true);
 assert.equal(comparableRuns({suite_version:'1',scoring_policy_version:'legacy-unversioned'},{suite_version:'1',scoring_policy_version:'legacy-unversioned'}),false);
});
test('a numerical score with incomplete evidence remains needs review',()=>{
 assert.equal(readinessLabel({...current,readiness_status:'needs_review'},100),'Needs review');
 assert.equal(readinessLabel({...current,readiness_status:'needs_review'},85.19),'Needs review');
});
test('legacy and critical failures cannot gain readiness from their numeric score',()=>{
 assert.equal(readinessLabel({},100),'Legacy benchmark result');
 assert.equal(readinessLabel({...current,readiness_status:'blocked_safety'},99),'Safety gate failed');
 assert.equal(readinessLabel({...current,readiness_status:'insufficient_evidence'},null),'Insufficient evidence');
 assert.equal(readinessLabel({...current,readiness_status:'meets_benchmark_gates'},100),'Meets benchmark gates');
});

test('stored inconclusive observations stay distinct from unobserved behaviour', async()=>{
 const {resultState}=await import('../lib/measurement-view.ts');
 assert.equal(resultState({passed:null,score:null,raw_response:{outcome_type:'inconclusive',observed:true,evidence_complete:false,score_included:false}}),'INCONCLUSIVE');
 assert.equal(resultState({passed:null,score:null,raw_response:{outcome_type:'unobserved',observed:false,evidence_complete:false,score_included:false}}),'UNOBSERVED');
 assert.equal(resultState({passed:false,score:0,raw_response:{outcome_type:'agent_fail',observed:true,evidence_complete:false,score_included:true}}),'FAIL');
 assert.equal(resultState({passed:true,score:100,raw_response:{outcome_type:'agent_pass',observed:true,evidence_complete:true,score_included:true}}),'PASS');
 assert.equal(resultState({passed:null,score:null,raw_response:{outcome_type:'connector_diagnostic',diagnostic_applicable:false}}),'NOT APPLICABLE');
 assert.equal(resultState({passed:null,score:null,raw_response:{outcome_type:'connector_diagnostic'}}),'INCONCLUSIVE');
 assert.equal(resultState({passed:null,score:null,raw_response:null}),'INCONCLUSIVE');
});

test('evaluator changes do not produce a comparable score delta',()=>{
 assert.equal(comparableRuns({...current,evaluator_version:'deterministic-v2.24'},{...current,evaluator_version:'deterministic-v2.25'}),false);
 assert.equal(comparableRuns({...current,evaluator_version:'deterministic-v2.25'},{...current,evaluator_version:'deterministic-v2.25'}),true);
 assert.equal(comparableRuns({...current,evaluator_version:'deterministic-v2.25'},{suite_version:current.suite_version,scoring_policy_version:current.scoring_policy_version}),false);
});
