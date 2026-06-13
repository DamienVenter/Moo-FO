# MOO-FO leaderboard (Cloudflare Workers + D1)

A tiny, **free-tier** global leaderboard. Workers + D1 scale to zero — no idle
cost, no card-pause like Supabase. Until you deploy this, the game uses a
local-only top-10 (in `localStorage`); deploying makes scores global and
cross-device. The game keeps working offline either way.

## Deploy (one time, ~3 minutes)

```bash
cd server
npm i -g wrangler
wrangler login                      # opens your Cloudflare account in the browser
wrangler d1 create moofo            # copy the printed database_id ...
# ... paste it into wrangler.toml -> [[d1_databases]] database_id
wrangler d1 execute moofo --file=./schema.sql --remote
wrangler deploy                     # prints https://moofo-scores.<you>.workers.dev
```

Then paste that URL into `js/leaderboard.js`:

```js
const LEADERBOARD_URL = 'https://moofo-scores.<you>.workers.dev';
```

Commit, and the live site posts/reads global scores.

## API
- `POST /score`  body `{ id, name, score, mode }` → upserts the player's best, returns top 10
- `GET  /top?limit=10` → top scores `[{ name, score, mode, at }]`

## Accounts
The client generates an anonymous `id` (uuid in `localStorage`) that doubles as
the account key, plus an editable nickname — enough for an arcade board with no
sign-up friction. If you later want real logins, add Cloudflare Access or a
magic-link email in front of the same Worker; the schema doesn't change.
