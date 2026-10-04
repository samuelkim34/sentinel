CREATE TABLE IF NOT EXISTS agent_profiles (
  registration_id TEXT PRIMARY KEY REFERENCES registrations(id),
  connection_id TEXT NOT NULL UNIQUE REFERENCES connections(id),
  instructions TEXT NOT NULL CHECK (length(instructions) <= 4000),
  execution_epoch INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (registration_id, user_id)
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  requester_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CHAT','TASK')),
  conversation_id TEXT REFERENCES agent_conversations(id),
  message_id INTEGER REFERENCES agent_messages(id),
  task_id TEXT REFERENCES tasks(id),
  selected_mandate_id TEXT REFERENCES mandates(id),
  trigger_key TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  claim_token TEXT,
  claimed_until INTEGER,
  steps INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  summary TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_one_running ON agent_runs(registration_id) WHERE state = 'RUNNING';
CREATE INDEX IF NOT EXISTS agent_due ON agent_runs(state, created_at);
CREATE INDEX IF NOT EXISTS agent_history ON agent_messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS agent_tool_calls (
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  call_id TEXT NOT NULL,
  name TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  is_error INTEGER NOT NULL CHECK (is_error IN (0,1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, call_id)
);
CREATE TABLE IF NOT EXISTS agent_worker_status (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  last_seen_at INTEGER NOT NULL,
  pid INTEGER
);
