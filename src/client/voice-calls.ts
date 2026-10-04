export type ProviderCall = { call_id: string; name: string; arguments: string };

// response.done contains the complete call set. Finish every parallel call before
// creating a continuation; argument-done events alone do not seal the batch.
export async function resolveVoiceCalls(calls: ProviderCall[], execute: (call: ProviderCall) => Promise<unknown>, send: (event: unknown) => void, active: () => boolean) {
  await Promise.all(calls.map(async (call) => {
    let result: unknown;
    try { result = await execute(call); }
    catch (cause) { result = { error: cause instanceof Error ? cause.message : "The tool request failed. No success is confirmed." }; }
    if (active()) send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } });
  }));
  if (calls.length && active()) send({ type: "response.create" });
}
