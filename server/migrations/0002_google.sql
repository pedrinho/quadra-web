-- Signing in with Google.
--
-- A player is still one row in `players`; this adds the other ways of proving you are them. A
-- Google account is identified by its `sub` — stable for the life of the account, unlike the
-- address, which its owner can change. Players who only ever sign in this way hold the
-- `NO_PASSWORD` marker in `password_hash`, which no password can match.

CREATE TABLE identities (
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_player ON identities (player_id);

-- Somebody Google has vouched for who has not yet picked the name that goes on the board. The
-- row is the space between the two; the player is created only once there is a name, so the
-- board never shows a name its owner did not choose — and never the real one Google knows.
-- The id is the SHA-256 of the token in their address bar, as with every other token here.
CREATE TABLE signups (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX signups_expiry ON signups (expires_at);
