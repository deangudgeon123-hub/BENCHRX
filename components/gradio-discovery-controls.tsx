'use client';
import {useState} from 'react';
import type {ConnectorRecipe, GradioDiscovery} from '@/lib/connectors/types';
import {gradioRecipeFields} from '@/lib/connectors/recipe-form';
import {gradioEndpointDiagnostics} from '@/lib/connectors/gradio-diagnostics';

export function GradioDiscoveryControls({onApply}: {onApply: () => void}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GradioDiscovery | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [notice, setNotice] = useState('');
  const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
  async function discover(form: HTMLFormElement) {
    const url = field(form, 'spaceUrl')?.value.trim() ?? '';
    setResult(null); setNotice('');
    if (!url) {setNotice('Enter a Gradio or Hugging Face Space URL first.'); return;}
    setBusy(true);
    try {
      const response = await fetch('/api/connections/discover', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({spaceUrl: url}), signal: AbortSignal.timeout(60000)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Discovery failed. Manual configuration is still available.');
      if (field(form, 'spaceUrl')?.value.trim() !== url) {setNotice('The URL changed. Run discovery again for the new Space.'); return;}
      setResult(data); setSourceUrl(url); setNotice(data.message);
    } catch (error) {setNotice(error instanceof Error ? error.message : 'Discovery failed. Use manual configuration.');}
    finally {setBusy(false);}
  }
  function apply(form: HTMLFormElement, recipe: ConnectorRecipe) {
    if (field(form, 'spaceUrl')?.value.trim() !== sourceUrl) {setResult(null); setNotice('The URL changed. Run discovery again.'); return;}
    const values = gradioRecipeFields(recipe);
    for (const [name, value] of Object.entries(values)) {const input = field(form, name); if (input) input.value = value;}
    setSourceUrl(values.spaceUrl);
    setNotice('Recipe applied. Review the editable fields below, then test the connection.');
    onApply();
  }
  return <div className="mt-4 space-y-3">
    <button type="button" disabled={busy} className="rounded-full border border-white/20 px-4 py-2 text-sm font-bold disabled:opacity-60" onClick={event => {const form = event.currentTarget.form; if (form) void discover(form);}}>
      {busy ? 'Discovering API…' : 'Discover API'}
    </button>
    <p className="text-xs leading-5 text-[var(--muted)]">Discovery reads the public API schema and proposes a configuration. It does not run the agent. Manual configuration remains available below.</p>
    {notice && <p role="status" className="text-sm text-[var(--muted)]">{notice}</p>}
    {result?.recipes.map((recipe, index) => <div key={index} className="rounded-xl border border-white/10 p-3">
      <p className="text-sm font-bold">{recipe.label}</p>
      <pre className="my-2 overflow-auto whitespace-pre-wrap break-all text-xs text-[var(--muted)]">{recipe.config.inputs}</pre>
      <p className="text-xs text-[var(--muted)]">Assistant output index: {recipe.config.outputIndex}</p>
      <button type="button" className="mt-2 rounded-full border border-white/20 px-3 py-2 text-sm font-bold" onClick={event => {const form = event.currentTarget.form; if (form) apply(form, recipe);}}>Apply recipe</button>
    </div>)}
    {!!result?.endpoints.length && <details className="text-xs text-[var(--muted)]"><summary className="cursor-pointer">Discovered API schema</summary>
      <ul className="mt-2 space-y-3">{result.endpoints.map(endpoint => {
        const diagnostics = gradioEndpointDiagnostics(endpoint);
        return <li key={endpoint.apiName}>
          <strong>/{endpoint.apiName}</strong> — {endpoint.inputCount} inputs, {endpoint.outputCount} outputs
          <p>Inputs: {endpoint.inputs.map((p, i) => `${i}: ${p.name} (${p.type || p.component || 'unknown'})`).join('; ') || 'none'}</p>
          <p>Outputs: {endpoint.outputs.map((p, i) => `${i}: ${p.name} (${p.type || p.component || 'unknown'})`).join('; ') || 'none'}</p>
          <details className="mt-1 rounded-lg border border-white/10 p-2">
            <summary className="cursor-pointer">Discovery diagnostics</summary>
            <div className="mt-2 space-y-1 font-mono text-[11px] leading-5">
              <p>reason={diagnostics.reason}</p>
              <p>invocation={diagnostics.invocation}; text_suite={diagnostics.textSuite}; workflow={diagnostics.workflow}</p>
              <p>schema_candidates: text=[{diagnostics.schemaCandidates.textInputs.join(',')}]; structured=[{diagnostics.schemaCandidates.structuredInputs.join(',')}]; assistant=[{diagnostics.schemaCandidates.assistantOutputs.join(',')}]</p>
              {diagnostics.inputs.map(input => <p key={`in-${input.index}`}>input[{input.index}]: type={input.type || 'unknown'}; component={input.component || 'unknown'}; message_shape={input.messageShape ?? 'none'}; default={input.defaultSafety}; required={String(input.required)}; state={String(input.state)}; hidden={String(input.hidden)}</p>)}
              {diagnostics.outputs.map(output => <p key={`out-${output.index}`}>output[{output.index}]: type={output.type || 'unknown'}; component={output.component || 'unknown'}; state={String(output.state)}; hidden={String(output.hidden)}</p>)}
            </div>
          </details>
        </li>;
      })}</ul>
    </details>}
  </div>;
}
