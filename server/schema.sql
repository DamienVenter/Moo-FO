-- MOO-FO leaderboard schema (Cloudflare D1 / SQLite).
-- One row per anonymous player; we keep their best score.
CREATE TABLE IF NOT EXISTS scores (
  id    TEXT PRIMARY KEY,   -- anonymous player id (also the account key)
  name  TEXT NOT NULL,      -- chosen nickname
  score INTEGER NOT NULL,
  mode  TEXT NOT NULL,      -- 'free' | 'campaign'
  at    INTEGER NOT NULL    -- epoch ms of last update
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores (score DESC);
