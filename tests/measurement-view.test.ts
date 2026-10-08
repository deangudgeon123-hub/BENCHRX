import test from 'node:test';
import assert from 'node:assert/strict';
import {behaviouralEvidenceSummary, comparableRuns, diagnosticSummary, readinessLabel, scoreEvidenceNotice, withholdingReason} from '../lib/measurement-view.ts';
const current={suite_version:'2.0',scoring_policy_version:'behavioural-v2.2',evaluator_version:'deterministic-v2.25'};
const coverage={task_success:{observed:12,total:12},reliability:{observed:7,total:7},safety:{observed:6,total:8}};
test('Frontier 91.96 with 6/8 safety is visibly provisional without changing verdicts',()=>{
 const run={...current,coverage,readiness_status:'needs_review'};
 const before=JSON.stringify(run);
 const notice=scoreEvidenceNotice(run,91.96);
 assert.equal(notice?.label,'Provisional — incomplete behavioural coverage');
 assert.match(notice?.detail??'',/Safety: 6\/8 conclusive/);
 assert.match(notice?.detail??'',/not passes/);
 assert.equal(readinessLabel(run,91.96),'Needs review');
 assert.equal(JSON.stringify(run),before);
});
test('complete coverage, withheld scores, legacy and A2A compatibility keep their own labels',()=>{
 assert.equal(scoreEvidenceNotice({...current,coverage:{...coverage,safety:{observed:8,total:8}}},95.53),null);
 assert.equal(scoreEvidenceNotice({...current,coverage},null),null);
 assert.equal(scoreEvidenceNotice({scoring_policy_version:'legacy-unversioned',coverage},100),null);
 for(const policy of ['structured-a2a-v1.0','a2a-compatibility-v1']) assert.equal(scoreEvidenceNotice({...current,scoring_policy_version:policy,coverage},100),null);
});
test('partial coverage cannot hide a safety failure and unknown coverage is not called complete',()=>{
 const run={...current,coverage,readiness_status:'blocked_safety'};
 assert.ok(scoreEvidenceNotice(run,95));
 assert.equal(readinessLabel(run,95),'Safety gate failed');
 for(const missing of [undefined,{}, {...coverage,safety:{observed:9,total:8}}]) assert.equal(scoreEvidenceNotice({...current,coverage:missing},100)?.label,'Provisional — coverage unverified');
 assert.equal(scoreEvidenceNotice({...current,coverage},NaN),null);
 const notice=scoreEvidenceNotice({...current,coverage:{...coverage,task_success:{observed:10,total:12}}},90);
 assert.match(notice?.detail??'',/Tasks: 10\/12 conclusive · Safety: 6\/8 conclusive/);
});
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
