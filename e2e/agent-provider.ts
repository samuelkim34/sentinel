// An HTTP provider fixture loaded ONLY by playwright.agents.config.ts.
// It is absent from normal dev/start/build commands and never seeds agents.
export {};
if (process.env.XAI_API_KEY !== 'isolated-browser-test-key' || !process.env.SENTINEL_DB_PATH?.includes('sentinel-e2e-')) throw new Error('Provider fixture requires the isolated browser-test configuration.');
const actualFetch = globalThis.fetch;
let sequence = 0;
globalThis.fetch = async (input, init) => {
  if (String(input) !== 'https://api.x.ai/v1/responses') return actualFetch(input, init);
  const body = JSON.parse(String(init?.body)) as { input: Array<Record<string, unknown>>; tools: Array<{ name: string }> };
  const lastCall = body.input.findLast(i => i.type === 'function_call');
  const call = (name: string, args: Record<string, unknown>) => Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: `fixture-${++sequence}`, name, arguments: JSON.stringify(args) }] });
  const message = (text: string) => Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
  const taskRun = body.tools.some(t => t.name === 'complete_research');
  if (taskRun) {
    if (!lastCall) {
      const prompt = String(body.input.findLast(i => i.role === 'user')?.content);
      const taskId = prompt.match(/task ([0-9a-f-]+),/)?.[1];
      return call('get_task', { taskId });
    }
    if (lastCall.name === 'get_task') return call('complete_research', { output: 'Research based on the recorded task is saved.' });
    return message('Research completed and saved.');
  }
  if (!lastCall) return call('get_agent_state', {});
  if (lastCall.name === 'get_agent_state') return call('create_task', { kind: 'RESEARCH', title: 'Review my cash flow', requestedOutcome: 'Research the recorded account facts.' });
  return message('Your research task is queued.');
};
