// Only fixed codes and trusted HTTP status values may cross the diagnostic boundary.
export class GradioInvocationError extends Error {
  stage: 'payload' | 'submit' | 'event_id' | 'poll' | 'job' | 'completion' | 'output';
  code: 'timeout' | 'serialization' | 'transport' | 'http_status' | 'invalid_event_id' | 'job_failed' | 'rate_limited' | 'gpu_unavailable' | 'invalid_input' | 'upstream_runtime_error' | 'incomplete_stream' | 'invalid_json' | 'invalid_output';
  httpStatus?: number;
  stepIndex?: number;
  constructor(stage: GradioInvocationError['stage'], code: GradioInvocationError['code'], httpStatus?: number) {
    super(`Gradio ${stage}: ${code}`);
    this.stage = stage; this.code = code; this.httpStatus = httpStatus;
  }
}
