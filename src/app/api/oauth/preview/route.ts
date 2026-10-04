import { errorResponse, json, resolveHuman } from "../../../../server/http";
import { getDb } from "../../../../storage/db";
import { row, rows, text } from "../../../../storage/sql";
import { loadMembership } from "../../../../domain/access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const human = await resolveHuman(request);
    const resource = new URL(request.url).searchParams.get("resource") ?? "";
    const connection = resource
      ? row(getDb(), "SELECT * FROM connections WHERE resource_uri = ? AND user_id = ? AND state = 'ACTIVE' AND auth_mode = 'OAUTH'", [resource, human.userId])
      : undefined;
    if (!connection || loadMembership(getDb(), text(connection.workspace_id), human.userId)?.state !== 'ACTIVE') {
      return json({
        matched: false,
        approvalAuthority: false,
        note: "This consent request did not match an active Sentinel connection for your account.",
      });
    }
    const workspace = row(getDb(), "SELECT label, kind FROM workspaces WHERE id = ?", [text(connection.workspace_id)]);
    const registration = row(getDb(), "SELECT name, purpose, state FROM registrations WHERE id = ?", [text(connection.registration_id)]);
    const accounts = rows(
      getDb(),
      `SELECT w.label FROM wallets w
       JOIN read_grants g ON g.wallet_id = w.id AND g.state = 'ACTIVE'
       WHERE g.registration_id = ?`,
      [text(connection.registration_id)],
    ).map((item) => text(item.label));
    const mandate = row(
      getDb(),
      "SELECT id FROM mandates WHERE registration_id = ? AND state = 'ACTIVE' AND expires_at > ?",
      [text(connection.registration_id), Date.now()],
    );
    return json({
      matched: true,
      approvalAuthority: false,
      workspace: workspace ? text(workspace.label) : "Workspace",
      workspaceKind: workspace ? text(workspace.kind) : "",
      registration: registration ? text(registration.name) : "Registration",
      purpose: registration ? text(registration.purpose) : "",
      registrationState: registration ? text(registration.state) : "",
      accounts,
      scopes: JSON.parse(text(connection.scopes)) as string[],
      proposalsWrite: Boolean(mandate),
      connectionState: text(connection.state),
      revoked: text(connection.state) === "REVOKED",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
