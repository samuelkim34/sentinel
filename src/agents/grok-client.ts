import { z } from 'zod';
import { unavailable } from '../contracts/errors';
import { getEnv } from '../server/env';

export type ModelItem = Record<string, unknown>;
export type ModelRequest = { model: string; input: ModelItem[]; tools: ModelItem[]; signal?: AbortSignal };
export type FunctionCall = { type: 'function_call'; call_id: string; name: string; arguments: string };
export type ModelResponse = { output: ModelItem[]; calls: FunctionCall[]; text: string };
export type ModelProvider = (request: ModelRequest) => Promise<ModelResponse>;

const callSchema = z.object({ type: z.literal('function_call'), call_id: z.string().min(1).max(200), name: z.string().min(1).max(100), arguments: z.string().max(20_000) });

// Kept separate from the worker so tests can supply a controlled provider.
// Runtime always uses xAI; there is no simulated-agent mode or seeded persona.
export const grokResponse: ModelProvider = async (request) => {
  const env = getEnv();
  if (!env.XAI_API_KEY) throw unavailable('AGENTS_NOT_CONFIGURED', 'Configure XAI_API_KEY on the server.');
  const { signal, ...payload } = request;
  const body = JSON.stringify({ ...payload, store: false, parallel_tool_calls: false, max_output_tokens: env.AGENT_MAX_OUTPUT_TOKENS });
  if (Buffer.byteLength(body) > 500_000) throw unavailable('AGENT_CONTEXT_LIMIT', 'The conversation context is too large. Start a shorter request.');
  let response: Response;
  try {
    response = await fetch('https://api.x.ai/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${env.XAI_API_KEY}`, 'content-type': 'application/json' }, body, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(env.AGENT_REQUEST_TIMEOUT_SECONDS * 1000), ...(signal ? [signal] : [])]) });
  } catch { throw unavailable('AGENT_PROVIDER_UNAVAILABLE', 'Grok could not be reached. Review activity before retrying.'); }
  if (!response.ok) {
    await response.body?.cancel();
    const code = response.status === 401 || response.status === 403 ? 'AGENT_PROVIDER_AUTH' : response.status === 429 ? 'AGENT_PROVIDER_RATE_LIMIT' : 'AGENT_PROVIDER_ERROR';
    throw unavailable(code, response.status === 401 || response.status === 403 ? 'The operator must check the xAI key and model access.' : 'Grok rejected this request. Review activity before retrying.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw unavailable('AGENT_PROVIDER_FORMAT', 'Grok returned no response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2_000_000) { await reader.cancel(); throw unavailable('AGENT_PROVIDER_FORMAT', 'Grok returned an oversized response.'); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') throw error;
    throw unavailable('AGENT_PROVIDER_UNAVAILABLE', 'Grok’s response was interrupted. Review activity before retrying.');
  } finally { reader.releaseLock(); }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw unavailable('AGENT_PROVIDER_FORMAT', 'Grok returned an invalid response.'); }
  return parseModelResponse(data);
};

export function parseModelResponse(data: unknown): ModelResponse {
  const parsed = z.object({ status: z.string(), output: z.array(z.record(z.string(), z.unknown())).max(60) }).safeParse(data);
  if (!parsed.success || parsed.data.status !== 'completed') throw unavailable('AGENT_PROVIDER_INCOMPLETE', 'Grok did not complete its response. Review activity before retrying.');
  const output: ModelItem[] = []; const calls: FunctionCall[] = []; const texts: string[] = [];
  for (const item of parsed.data.output) {
    if (item.type === 'function_call') {
      const call = callSchema.safeParse(item);
      if (!call.success) throw unavailable('AGENT_PROVIDER_FORMAT', 'Grok returned a malformed tool request.');
      calls.push(call.data); output.push(call.data);
    } else if (item.type === 'message') {
      const message = z.object({ role: z.literal('assistant'), content: z.array(z.object({ type: z.string(), text: z.string().max(24_000).optional(), refusal: z.string().max(4000).optional() })).max(30) }).safeParse(item);
      if (!message.success) throw unavailable('AGENT_PROVIDER_FORMAT', 'Grok returned a malformed message.');
      const content = message.data.content.filter(c => c.type === 'output_text' && c.text).map(c => ({ type: 'output_text', text: c.text }));
      for (const part of content) texts.push(part.text!);
      for (const part of message.data.content) if (part.type === 'refusal' && part.refusal) texts.push(part.refusal);
      if (content.length) output.push({ type: 'message', role: 'assistant', content });
    }
    // Reasoning is neither shown nor persisted. The full visible messages and
    // function call/output pairs are sent on the next turn with store:false.
  }
  if (!calls.length && !texts.length) throw unavailable('AGENT_PROVIDER_FORMAT', 'Grok returned no usable message or tool request.');
  return { output, calls, text: texts.join('\n').slice(0, 16_000) };
}
