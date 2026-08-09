-- The board, and the people on it.
--
-- Two rules shape this schema. Nothing is stored that the server did not derive itself, the
-- e-mail and the password hash aside — a score is never a number the client sent. And a run is
-- kept as its recording, so anything a row claims can be watched; the bytes live in R2 and the
-- key to them is the only thing this database holds about them.

CREATE TABLE players (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  -- Lowercased and trimmed. Uniqueness is on this, not on `email`, so that two people cannot
  -- register the same address in different cases.
  email_key         TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  -- Case-folded name, for the same reason, and additionally so that two names that differ only
  -- in case cannot both sit on the board.
  display_name_key  TEXT NOT NULL,
  -- Null until the address is confirmed. A run cannot be ranked before this is set.
  verified_at       INTEGER,
  created_at        INTEGER NOT NULL,
  renamed_at        INTEGER
);
CREATE UNIQUE INDEX players_email_key ON players (email_key);
CREATE UNIQUE INDEX players_display_name_key ON players (display_name_key);

-- The SHA-256 of the cookie token is the id, so the table never holds anything that would let
-- someone holding a database dump sign in. Sessions are revoked with a DELETE, which is the
-- reason they are rows and not a signed token.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX sessions_player ON sessions (player_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- Verification and password-reset links, hashed on the same principle as sessions.
CREATE TABLE email_tokens (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX email_tokens_player ON email_tokens (player_id, kind);

-- A seed the server issued, for one run, to one player.
--
-- Without this a player restarts until the piece stream is friendly and submits only the run that
-- went well: verification proves that these inputs produce this score, never that the game was
-- worth playing. A grant is also what stops a tape being submitted twice, or submitted by someone
-- who did not play it.
CREATE TABLE grants (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  -- Decimal text: a seed is a 64-bit unsigned integer and SQLite's INTEGER is signed.
  seed        TEXT NOT NULL,
  issued_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX grants_player ON grants (player_id, issued_at);

-- A finished, verified run. Every column here came out of `verify()` reading the tape; none of it
-- was sent by the client.
CREATE TABLE runs (
  id            TEXT PRIMARY KEY,
  -- Null once the account is closed. The run stays: deleting it would rewrite the history of
  -- everyone who was ranked against it, and what is left is a score and a recording of a game,
  -- which is not personal information about anybody.
  player_id     TEXT REFERENCES players (id) ON DELETE SET NULL,
  grant_id      TEXT REFERENCES grants (id) ON DELETE SET NULL,
  score         INTEGER NOT NULL,
  lines         INTEGER NOT NULL,
  level         INTEGER NOT NULL,
  frames        INTEGER NOT NULL,
  ticks         INTEGER NOT NULL,
  paused_ticks  INTEGER NOT NULL,
  -- The board is scoped to this: an engine change invalidates every stored tape by design, and
  -- runs from an older simulation stay in the table as history rather than being deleted.
  sim_version   INTEGER NOT NULL,
  seed          TEXT NOT NULL,
  state_hash    TEXT NOT NULL,
  board_hash    TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  verified_at   INTEGER NOT NULL,
  -- Whether the run ended in a top-out rather than the recording simply stopping.
  over          INTEGER NOT NULL,
  -- The R2 key the tape is under. The bytes are the run; this row is a summary of them.
  tape_key      TEXT NOT NULL
);
-- The board query: best score first, then the same score in fewer frames, which is the better
-- game. Matches the ordering the local board used before there was a server.
CREATE INDEX runs_board ON runs (sim_version, score DESC, frames ASC);
CREATE INDEX runs_player ON runs (player_id, score DESC);
CREATE INDEX runs_recent ON runs (sim_version, verified_at DESC);
-- The same end state reached in the same number of frames is the same run submitted twice.
CREATE UNIQUE INDEX runs_identity ON runs (player_id, state_hash, frames);

-- Fixed-window counters for the auth paths and for seed grants. A table rather than a second
-- binding: these are low-volume endpoints, and a row here is cheaper than an extra service.
CREATE TABLE rate_limits (
  -- bucket + subject + window start, joined — one row per window, incremented in place.
  id          TEXT PRIMARY KEY,
  count       INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits (expires_at);
