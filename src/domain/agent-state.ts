import type { DatabaseSync } from "node:sqlite";
import { num, row, rows, text } from "../storage/sql";
import { getEnv } from "../server/env";
import { getRegistration } from "./authority";
import { getTask, listTasks } from "./proposals";
import { getWallet } from "./accounts";
import type { HumanContext } from "./access";

// Text agents and optional external tools read the same persisted facts.
export function agentState(db: DatabaseSync, human: HumanContext, registrationId: string, now = Date.now()) {
  const registration = getRegistration(db, human, registrationId);
  const grants = rows(db, "SELECT wallet_id FROM read_grants WHERE registration_id = ? AND state = 'ACTIVE'", [registrationId]);
  const wallets = grants.map((grant) => getWallet(db, human, text(grant.wallet_id)));
  const tasks = listTasks(db, human).filter((task) => task.registrationId === registrationId).slice(0, 30).map((task) => getTask(db, human, task.id));
  const connection = row(db, "SELECT MAX(last_seen_at) AS seen FROM connections WHERE registration_id = ? AND state = 'ACTIVE'", [registrationId]);
  const recentChat = rows(db, `SELECT m.role, m.text, m.created_at FROM agent_messages m JOIN agent_conversations c ON c.id = m.conversation_id
    WHERE c.registration_id = ? AND c.user_id = ? ORDER BY m.id DESC LIMIT 12`, [registrationId, human.userId]).reverse().map(m => ({ role: text(m.role), text: text(m.text), createdAt: num(m.created_at) }));
  return {
    registration, wallets, tasks, recentChat,
    serverTime: new Date(now).toISOString(), freshnessSeconds: getEnv().BANK_FRESHNESS_SECONDS,
    supportedActions: ["merchant_purchase"], approvalAuthority: false,
    lastToolAccess: connection?.seen ? num(connection.seen) : null,
  };
}
