import assert from "node:assert/strict";
import { beforeEach, afterEach, it } from "node:test";
import { fixture, testEnv } from "./support";
import { run, row } from "../src/storage/sql";
import { resetEnvCache } from "../src/server/env";
import { AppError } from "../src/contracts/errors";
import { createVoiceSession, executeVoiceTool, appendTranscript, setTranscriptRetention, confirmAuthorityDraft } from "../src/domain/voice";
import { createRegistration } from "../src/domain/authority";
import { createTask } from "../src/domain/proposals";
import { StreamingResampler, AudioFramer, floatToPcm16 } from "../src/client/audio";
import { resolveVoiceCalls } from "../src/client/voice-calls";

const originalFetch = globalThis.fetch;
beforeEach(() => { testEnv(); process.env.XAI_API_KEY = "fixture-server-key-never-used-with-a-provider"; resetEnvCache(); globalThis.fetch = async () => Response.json({ value: "fixture-ephemeral-credential" }); });
afterEach(() => { globalThis.fetch = originalFetch; });
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;
function ready() { const f = fixture(); run(f.db, "UPDATE connections SET tools_verified_at = ?", [f.now]); return f; }

it("provider failures close the reserved voice session so the user can retry", async () => {
  const f = ready(); globalThis.fetch = async () => Response.json({ error: "fixture failure" }, { status: 503 });
  await assert.rejects(createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now), code("VOICE_PROVIDER"));
  assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM voice_sessions WHERE state = 'ACTIVE'")?.c, 0);
  globalThis.fetch = async () => Response.json({ value: "fixture-ephemeral" });
  assert.ok((await createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now)).sessionId); f.db.close();
});

it("concurrent voice starts create exactly one active session", async () => {
  const f = ready(); const results = await Promise.allSettled([createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now), createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM voice_sessions WHERE state = 'ACTIVE'")?.c, 1); f.db.close();
});

it("voice calls replay by call ID and reject changed arguments without collapsing new intentions", async () => {
  const f = ready(); const session = await createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now);
  const call = { callId: "call-1", name: "create_task", arguments: { kind: "RESEARCH", title: "Question", requestedOutcome: "Research this question" } };
  const a = executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, call, f.now);
  assert.deepEqual(executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, call, f.now), a);
  assert.throws(() => executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, { ...call, arguments: { ...call.arguments, title: "Changed" } }, f.now), code("VOICE_CALL_CONFLICT"));
  executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, { ...call, callId: "call-2" }, f.now);
  assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM tasks")?.c, 2); f.db.close();
});

it("a failed voice journal rolls back the task mutation as well", async () => {
  const f = ready(); const session = await createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now);
  f.db.exec("CREATE TRIGGER fixture_journal_failure BEFORE INSERT ON voice_tool_calls BEGIN SELECT RAISE(ABORT, 'fixture journal failure'); END");
  assert.throws(() => executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, { callId: "call-1", name: "create_task", arguments: { kind: "RESEARCH", title: "Question", requestedOutcome: "Question" } }, f.now), /fixture journal failure/);
  assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM tasks")?.c, 0); f.db.close();
});

it("voice cannot read another Bot's task even when the signed-in owner can", async () => {
  const f = ready(); const other = createRegistration(f.db, f.owner, { name: "Other fixture", purpose: "Other", walletIds: [] }, f.now); const task = createTask(f.db, f.owner, { registrationId: other.id, kind: "RESEARCH", title: "Other", requestedOutcome: "Other" }, f.now);
  const session = await createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now);
  assert.throws(() => executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, { callId: "other", name: "get_task", arguments: { taskId: task.id } }, f.now), code("VOICE_TASK_BOUNDARY")); f.db.close();
});

it("voice rechecks workspace binding, membership, and expiry for each call", async () => {
  const f = ready(); const session = await createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now); const call = { callId: "read", name: "get_context", arguments: {} };
  assert.throws(() => executeVoiceTool(f.db, { ...f.owner, workspaceId: "other" }, session.sessionId, session.toolToken, call, f.now));
  assert.throws(() => executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, call, session.expiresAt), code("VOICE_TOKEN"));
  run(f.db, "UPDATE memberships SET state = 'REMOVED' WHERE workspace_id = ?", [f.workspace.id]);
  assert.throws(() => executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, call, f.now)); f.db.close();
});

it("disabling retention deletes text and immediately prevents active-session storage", async () => {
  const f = ready(); setTranscriptRetention(f.db, "owner", true); const session = await createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now);
  assert.deepEqual(appendTranscript(f.db, f.owner, session.sessionId, session.toolToken, { speaker: "user", text: "Fixture transcript", final: true }, f.now), { stored: true });
  setTranscriptRetention(f.db, "owner", false);
  assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM voice_messages")?.c, 0);
  assert.deepEqual(appendTranscript(f.db, f.owner, session.sessionId, session.toolToken, { speaker: "user", text: "Do not retain this", final: true }, f.now), { stored: false }); f.db.close();
});

it("voice authority is a bound draft and can be confirmed only once", async () => {
  const f = ready(); const session = await createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, f.now);
  const terms = { walletId: "wallet", totalAllowance: "40.00", perPurchaseLimit: "10.00", reviewAbove: "5.00", allowedCategories: ["GROCERIES"], allowedMerchantIds: null, executionMode: "PROPOSE_ONLY", expiresAt: f.now + 86400000, replaceMandateId: f.mandate.id };
  const draft = executeVoiceTool(f.db, f.owner, session.sessionId, session.toolToken, { callId: "draft", name: "draft_authority_change", arguments: terms }, f.now) as { id: string };
  assert.equal(row(f.db, "SELECT state FROM mandates WHERE id = ?", [f.mandate.id])?.state, "ACTIVE");
  confirmAuthorityDraft(f.db, f.owner, draft.id, f.now);
  assert.equal(row(f.db, "SELECT state FROM mandates WHERE id = ?", [f.mandate.id])?.state, "REVOKED");
  assert.throws(() => confirmAuthorityDraft(f.db, f.owner, draft.id, f.now), code("DRAFT_INACTIVE")); f.db.close();
});

it("streamed 44.1 kHz audio preserves sample position across chunks", () => {
  const samples = Float32Array.from({ length: 4410 }, (_, index) => Math.sin(index / 10));
  const whole = new StreamingResampler(44100).process(samples); const split = new StreamingResampler(44100); const output: number[] = [];
  for (let index = 0; index < samples.length; index += 128) output.push(...split.process(samples.subarray(index, index + 128)));
  assert.equal(output.length, whole.length);
  output.forEach((sample, index) => assert.ok(Math.abs(sample - whole[index]!) < 0.000001));
  const frames = new AudioFramer(); assert.equal(frames.push(new Float32Array(479)).length, 0); assert.equal(frames.push(new Float32Array(1))[0]?.length, 480);
  assert.deepEqual([...floatToPcm16(new Float32Array([-1, 0, 1]))], [0, 128, 0, 0, 255, 127]);
});

it("parallel voice calls produce one continuation after every output, including failures", async () => {
  const events: Array<{ type: string }> = []; let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const batch = resolveVoiceCalls([{ call_id: "first", name: "get_context", arguments: "{}" }, { call_id: "second", name: "get_task", arguments: "{}" }], async (call) => { if (call.call_id === "first") await gate; else throw new Error("Fixture failure"); return { ok: true }; }, (event) => events.push(event as { type: string }), () => true);
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(events.filter((event) => event.type === "response.create").length, 0); release!(); await batch;
  assert.deepEqual(events.map((event) => event.type), ["conversation.item.create", "conversation.item.create", "response.create"]);
});
