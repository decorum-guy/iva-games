import type Database from 'better-sqlite3';

/** Independent integration version: never changes the platform's PRAGMA user_version. */
export function ensureTelegramSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS telegram_schema (component TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    const row = db.prepare("SELECT version FROM telegram_schema WHERE component='telegram'").get() as { version: number } | undefined;
    if (row && row.version !== 1) throw new Error('Unsupported Telegram integration schema');
    if (row) return;
    db.exec(`
      CREATE TABLE telegram_link_attempts (
        attempt_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES players(player_id),
        session_hash TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK(state IN ('issued','awaiting_web_confirmation','confirmed','expired','cancelled','rejected')),
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        candidate_user_id INTEGER, candidate_chat_id INTEGER, candidate_display_json TEXT,
        proof_hash TEXT, proof_failures INTEGER NOT NULL DEFAULT 0,
        binding_id TEXT, confirmed_consent INTEGER, consumed_at INTEGER
      );
      CREATE UNIQUE INDEX telegram_one_active_attempt ON telegram_link_attempts(player_id)
        WHERE state IN ('issued','awaiting_web_confirmation');
      CREATE TABLE telegram_bindings (
        binding_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES players(player_id),
        telegram_user_id INTEGER NOT NULL, private_chat_id INTEGER NOT NULL,
        display_json TEXT NOT NULL, binding_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','unreachable','revoked')),
        notifications_enabled INTEGER NOT NULL, consented_at INTEGER, linked_at INTEGER NOT NULL,
        revoked_at INTEGER, last_delivery_error TEXT
      );
      CREATE UNIQUE INDEX telegram_one_binding_per_player ON telegram_bindings(player_id)
        WHERE status IN ('active','unreachable');
      CREATE UNIQUE INDEX telegram_one_binding_per_identity ON telegram_bindings(bot_id,telegram_user_id)
        WHERE status IN ('active','unreachable');
      CREATE TABLE telegram_inbox (
        bot_id TEXT NOT NULL, update_id INTEGER NOT NULL, received_at INTEGER NOT NULL,
        body_hash TEXT NOT NULL, outcome TEXT NOT NULL,
        PRIMARY KEY(bot_id,update_id)
      );
      CREATE TABLE telegram_outbox (
        job_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('proof','invitation')),
        player_id TEXT NOT NULL REFERENCES players(player_id), attempt_id TEXT REFERENCES telegram_link_attempts(attempt_id),
        invitation_id TEXT REFERENCES invitations(invitation_id), binding_id TEXT REFERENCES telegram_bindings(binding_id),
        binding_version INTEGER, chat_id INTEGER NOT NULL, secret_ciphertext TEXT,
        state TEXT NOT NULL CHECK(state IN ('queued','sending','sent','retry_wait','delivery_unknown','permanent_failure','skipped')),
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, next_attempt_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_expires_at INTEGER,
        message_id TEXT, last_error TEXT
      );
      CREATE INDEX telegram_due_jobs ON telegram_outbox(state,next_attempt_at);
      INSERT INTO telegram_schema VALUES ('telegram',1);
    `);
  }).immediate();
}
