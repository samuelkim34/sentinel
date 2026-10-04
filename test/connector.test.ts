import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlaybackQueue, resampleLinear } from "../src/client/audio";
import { forbiddenToolsAbsent, MCP_TOOL_NAMES } from "../src/mcp/server";

describe("audio", () => {
  it("resamples to the requested rate and drops a superseded response", () => {
    const input = new Float32Array([0, 1, 0, -1]);
    const output = resampleLinear(input, 48000, 24000);
    assert.equal(output.length, 2);
    const queue = new PlaybackQueue();
    queue.push("a", new Float32Array([1]));
    queue.push("b", new Float32Array([2]));
    assert.deepEqual(Array.from(queue.drain()), [2]);
  });
});

describe("connector tools", () => {
  it("does not expose approval or payment tools", () => {
    assert.equal(forbiddenToolsAbsent(), true);
    assert.equal(MCP_TOOL_NAMES.includes("approve_purchase" as never), false);
    assert.equal(MCP_TOOL_NAMES.length, 10);
  });
});
