// MOO-FO global leaderboard — Cloudflare Worker (free tier, scales to zero).
//
// Deploy (one time, from /server):
//   npm i -g wrangler
//   wrangler login
//   wrangler d1 create moofo
//     -> copy the database_id into wrangler.toml
//   wrangler d1 execute moofo --file=./schema.sql --remote
//   wrangler deploy
// Then paste the printed *.workers.dev URL into js/leaderboard.js LEADERBOARD_URL.
//
// Endpoints:
//   POST /score  { id, name, score, mode }   -> upserts the player's best, returns top 10
//   GET  /top?limit=10                        -> returns the top scores

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (request.method === 'POST' && url.pathname === '/score') {
        const b = await request.json();
        const id = String(b.id || '').slice(0, 64);
        const name = String(b.name || 'Pilot').slice(0, 16);
        const score = Math.max(0, Math.min(10_000_000, Math.round(Number(b.score) || 0)));
        const mode = b.mode === 'campaign' ? 'campaign' : 'free';
        if (!id) return json({ error: 'missing id' }, 400);

        // keep only the player's best score
        await env.DB.prepare(
          `INSERT INTO scores (id, name, score, mode, at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(id) DO UPDATE SET
             name = ?2,
             score = MAX(score, ?3),
             mode = ?4,
             at = ?5`
        ).bind(id, name, score, mode, Date.now()).run();

        return json(await top(env, 10));
      }

      if (request.method === 'GET' && url.pathname === '/top') {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 10));
        return json(await top(env, limit));
      }

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

async function top(env, limit) {
  const { results } = await env.DB.prepare(
    `SELECT name, score, mode, at FROM scores ORDER BY score DESC LIMIT ?1`
  ).bind(limit).all();
  return results || [];
}
