// This is an output-content classification, NOT an upstream HTTP status or
// proof of the reported cause. Whole-output signatures only; ordinary answers,
// quoted examples and answers discussing errors must remain behavioural text.
export function isApplicationErrorOutput(value: string): boolean {
  const text = value.trim();
  if (text.length > 16_384) return false;
  return /^Error during chat: Error code: [45]\d{2} - \{['"]error['"]:\s*\{[\s\S]*['"]type['"]:\s*['"][a-z_]+['"][\s\S]*\}\}$/u.test(text)
    || /^(?:#{1,6} [^\n]*\bStage \d+: [^\n]*\n+\s*)?❌ The (?:council|agent) failed to generate a response\.$/u.test(text);
}
