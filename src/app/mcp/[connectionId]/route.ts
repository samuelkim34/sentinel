import { createMcpHandler } from "@modelcontextprotocol/server";
import { authenticateConnector } from "../../../mcp/auth";
import { buildMcpServer } from "../../../mcp/server";
import { errorResponse } from "../../../server/http";
import { getEnv } from "../../../server/env";

export const runtime = "nodejs";

async function handle(request: Request, connectionId: string) {
  try {
    const connector = await authenticateConnector(request, connectionId);
    const handler = createMcpHandler(() => buildMcpServer(connector));
    return handler.fetch(request);
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 401) {
      response.headers.set("www-authenticate", `Bearer resource_metadata="${getEnv().APP_ORIGIN}/.well-known/oauth-protected-resource/mcp/${encodeURIComponent(connectionId)}"`);
    }
    return response;
  }
}

export async function GET(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await context.params;
  return handle(request, connectionId);
}

export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await context.params;
  return handle(request, connectionId);
}

export async function DELETE(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await context.params;
  return handle(request, connectionId);
}
