import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forbiddenToolsAbsent, MCP_TOOL_NAMES } from "../src/mcp/server";

describe("connector tools", () => {
  it("does not expose approval or payment tools", () => {
    assert.equal(forbiddenToolsAbsent(), true);
    assert.equal(MCP_TOOL_NAMES.includes("approve_purchase" as never), false);
    assert.equal(MCP_TOOL_NAMES.length, 10);
  });
});
