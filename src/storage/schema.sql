CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('PERSONAL', 'BUSINESS')),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  timezone TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'finance', 'member')),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'REMOVED')),
  joined_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  token_hash TEXT NOT NULL UNIQUE,
  invited_role TEXT NOT NULL CHECK (invited_role IN ('owner', 'finance', 'member')),
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_by TEXT,
  accepted_at INTEGER
);

CREATE TABLE IF NOT EXISTS bank_link_permissions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  allowed_customer_id TEXT NOT NULL,
  grant_source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, allowed_customer_id)
);

CREATE TABLE IF NOT EXISTS bank_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL CHECK (provider = 'NESSIE'),
  credential_source TEXT NOT NULL CHECK (credential_source = 'ENV'),
  customer_id TEXT NOT NULL,
  configuration_state TEXT NOT NULL CHECK (configuration_state IN ('LINKED', 'ERROR')),
  last_verified_at INTEGER,
  UNIQUE (workspace_id, customer_id)
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  integration_id TEXT NOT NULL REFERENCES bank_integrations(id),
  upstream_account_id TEXT NOT NULL UNIQUE,
  upstream_customer_id TEXT NOT NULL,
  label TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  policy_balance_cents INTEGER NOT NULL CHECK (policy_balance_cents >= 0 AND policy_balance_cents <= 10000000000),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'QUARANTINED')),
  last_verified_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  quarantine_reason TEXT,
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS bank_observations (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  observed_balance_cents INTEGER NOT NULL CHECK (observed_balance_cents >= 0),
  observed_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  response_id TEXT,
  validation_state TEXT NOT NULL CHECK (validation_state IN ('VALID', 'INVALID')),
  raw_status TEXT
);

CREATE TABLE IF NOT EXISTS protections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 10000000000),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'DISABLED')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  FOREIGN KEY (workspace_id, wallet_id) REFERENCES wallets(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS merchant_catalog (
  id TEXT PRIMARY KEY,
  upstream_merchant_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  raw_category TEXT NOT NULL,
  verified_category TEXT NOT NULL,
  last_synced_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_permissions (
  workspace_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchant_catalog(id),
  verification_state TEXT NOT NULL CHECK (verification_state IN ('PENDING', 'CONFIRMED')),
  verified_category TEXT,
  set_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, merchant_id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  controller_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  purpose TEXT NOT NULL CHECK (length(purpose) BETWEEN 1 AND 500),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS read_grants (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  granted_by TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'REVOKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS read_grant_one_active
  ON read_grants(registration_id, wallet_id) WHERE state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  resource_uri TEXT NOT NULL UNIQUE,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('OAUTH', 'PERSONAL_TOKEN', 'INTERNAL')),
  token_hash TEXT,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'ACTIVE', 'REVOKED')),
  scopes TEXT NOT NULL,
  tools_verified_at INTEGER,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id, registration_id) REFERENCES registrations(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  controller_user_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  total_allowance_cents INTEGER NOT NULL CHECK (total_allowance_cents >= 0 AND total_allowance_cents <= 10000000000),
  per_purchase_limit_cents INTEGER NOT NULL CHECK (per_purchase_limit_cents > 0),
  review_above_cents INTEGER NOT NULL CHECK (review_above_cents >= 0),
  allowed_categories TEXT NOT NULL,
  allowed_merchant_ids TEXT,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('PROPOSE_ONLY', 'AUTO_WITHIN_LIMITS')),
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id, registration_id) REFERENCES registrations(workspace_id, id),
  FOREIGN KEY (workspace_id, wallet_id) REFERENCES wallets(workspace_id, id),
  UNIQUE (workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS mandate_one_active
  ON mandates(registration_id, wallet_id) WHERE state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  controller_user_id TEXT NOT NULL,
  mandate_id TEXT,
  wallet_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('RESEARCH', 'PURCHASE')),
  title TEXT NOT NULL,
  requested_outcome TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (state IN (
    'QUEUED', 'IN_PROGRESS', 'WAITING_APPROVAL', 'WAITING_PAYMENT',
    'BLOCKED', 'NEEDS_RECONCILIATION', 'PAUSED', 'COMPLETED', 'CANCELLED'
  )),
  created_by TEXT NOT NULL,
  intent_author_user_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id, registration_id) REFERENCES registrations(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS task_leases (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  connection_id TEXT NOT NULL REFERENCES connections(id),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  renewed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instructions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  registration_id TEXT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  authored_by TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('HUMAN_UI', 'VOICE')),
  text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'ACKNOWLEDGED', 'APPLIED')),
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  applied_at INTEGER,
  reported_outcome TEXT
);

CREATE TABLE IF NOT EXISTS task_updates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  connection_id TEXT,
  kind TEXT NOT NULL,
  phase TEXT NOT NULL,
  note TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  task_revision INTEGER NOT NULL,
  mandate_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchant_catalog(id),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 10000000000),
  reason TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'BLOCKED', 'REVIEW_REQUIRED', 'RESERVED', 'SUBMITTING', 'SUBMITTED_PENDING',
    'RECONCILE_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  decision_codes TEXT NOT NULL,
  explanation TEXT NOT NULL,
  available_cents INTEGER,
  cancel_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (task_id, task_revision),
  FOREIGN KEY (workspace_id, wallet_id) REFERENCES wallets(workspace_id, id),
  FOREIGN KEY (workspace_id, mandate_id) REFERENCES mandates(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS reservations (
  proposal_id TEXT PRIMARY KEY REFERENCES proposals(id),
  wallet_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  approver_user_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  terms_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_operations (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
  wallet_id TEXT NOT NULL,
  upstream_reference TEXT NOT NULL UNIQUE,
  upstream_id TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'SUBMITTING', 'SUBMITTED_PENDING', 'RECONCILE_REQUIRED', 'COMPLETED', 'FAILED'
  )),
  submission_count INTEGER NOT NULL CHECK (submission_count >= 0),
  submitted_at INTEGER,
  last_checked_at INTEGER,
  receipt_applied INTEGER NOT NULL DEFAULT 0 CHECK (receipt_applied IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_check_at INTEGER,
  manual_review INTEGER NOT NULL DEFAULT 0 CHECK (manual_review IN (0, 1)),
  detail TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_one_unresolved_per_wallet
  ON payment_operations(wallet_id)
  WHERE state IN ('SUBMITTING', 'SUBMITTED_PENDING', 'RECONCILE_REQUIRED');

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('DUE', 'CLAIMED', 'DONE', 'FAILED')),
  run_after INTEGER NOT NULL,
  claimed_at INTEGER,
  claim_token TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS authority_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  requested_by TEXT NOT NULL,
  source TEXT NOT NULL,
  exact_terms_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  task_id TEXT,
  token_hash TEXT NOT NULL,
  allowed_functions TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'ENDED', 'EXPIRED')),
  retain_transcript INTEGER NOT NULL DEFAULT 0 CHECK (retain_transcript IN (0, 1)),
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS voice_messages (
  session_id TEXT NOT NULL REFERENCES voice_sessions(id),
  sequence INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  final INTEGER NOT NULL CHECK (final IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, sequence)
);

CREATE TABLE IF NOT EXISTS voice_tool_calls (
  session_id TEXT NOT NULL REFERENCES voice_sessions(id),
  call_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, call_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_user_id TEXT,
  connection_id TEXT,
  event_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  safe_detail_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mutation_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  request_key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (actor_kind, actor_id, action, request_key)
);

CREATE TABLE IF NOT EXISTS reauth_grants (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  retain_voice_transcripts INTEGER NOT NULL DEFAULT 0 CHECK (retain_voice_transcripts IN (0, 1))
);

CREATE TABLE IF NOT EXISTS rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_status (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  last_seen_at INTEGER NOT NULL,
  pid INTEGER
);

CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id, state);
CREATE INDEX IF NOT EXISTS tasks_workspace_state ON tasks(workspace_id, state, registration_id);
CREATE INDEX IF NOT EXISTS proposals_review ON proposals(workspace_id, state, created_at);
CREATE INDEX IF NOT EXISTS reservations_wallet ON reservations(wallet_id, mandate_id);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state, run_after);
CREATE INDEX IF NOT EXISTS connections_active ON connections(registration_id, state);
CREATE INDEX IF NOT EXISTS audit_workspace ON audit_events(workspace_id, id);
CREATE INDEX IF NOT EXISTS rate_lookup ON rate_events(subject, action, created_at);
CREATE INDEX IF NOT EXISTS observations_wallet ON bank_observations(wallet_id, observed_at);
