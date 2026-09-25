import test from 'node:test';
import assert from 'node:assert/strict';
import {comparableRuns, diagnosticSummary, readinessLabel} from '../lib/measurement-view.ts';
const current={suite_version:'2.0',scoring_policy_version:'behavioural-v2.2'};
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
