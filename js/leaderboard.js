// MOO-FO — player identity + leaderboard.
//
// Storage strategy (the two free tiers we picked):
//   1) LOCAL  — always on, zero cost: an anonymous player id + editable
//      nickname + a local top-10 are kept in localStorage. Works offline,
//      per-device, forever.
//   2) REMOTE — cross-device + global board: set LEADERBOARD_URL to a deployed
//      Cloudflare Worker (see /server). When set, scores POST there and the
//      global top list is fetched from there; the anonymous id doubles as the
//      account key (a nickname is all most arcade boards need). If the endpoint
//      is empty or unreachable, everything gracefully falls back to LOCAL so
//      the game never blocks on the network.
//
// Flip to global by deploying /server (one wrangler command) and pasting the
// resulting URL into LEADERBOARD_URL below.

const LEADERBOARD_URL = ''; // e.g. 'https://moofo-scores.<you>.workers.dev'

const ID_KEY = 'moofo-player-id';
const NAME_KEY = 'moofo-player-name';
const LOCAL_TOP_KEY = 'moofo-local-top';
const MAX_LOCAL = 10;

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getPlayerId() {
  let id = null;
  try { id = localStorage.getItem(ID_KEY); } catch (_) { /* blocked */ }
  if (!id) {
    id = uuid();
    try { localStorage.setItem(ID_KEY, id); } catch (_) { /* blocked */ }
  }
  return id;
}

export function getNickname() {
  try { return localStorage.getItem(NAME_KEY) || 'Pilot'; } catch (_) { return 'Pilot'; }
}

export function setNickname(name) {
  const clean = String(name || '').trim().slice(0, 16) || 'Pilot';
  try { localStorage.setItem(NAME_KEY, clean); } catch (_) { /* blocked */ }
  return clean;
}

function readLocalTop() {
  try { return JSON.parse(localStorage.getItem(LOCAL_TOP_KEY) || '[]'); } catch (_) { return []; }
}

function writeLocalTop(list) {
  try { localStorage.setItem(LOCAL_TOP_KEY, JSON.stringify(list.slice(0, MAX_LOCAL))); } catch (_) { /* blocked */ }
}

/** Record a score. Returns the (best-effort) current top list. Never throws. */
export async function submitScore(score, mode = 'free') {
  const entry = { id: getPlayerId(), name: getNickname(), score: Math.round(score), mode, at: Date.now() };

  // keep a local board regardless of remote success
  const local = readLocalTop();
  local.push(entry);
  local.sort((a, b) => b.score - a.score);
  writeLocalTop(local);

  if (LEADERBOARD_URL) {
    try {
      const res = await fetch(`${LEADERBOARD_URL}/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (res.ok) return await res.json();
    } catch (_) { /* offline — fall through to local */ }
  }
  return readLocalTop();
}

/** Fetch the top scores (remote if configured + reachable, else local). */
export async function topScores(limit = 10) {
  if (LEADERBOARD_URL) {
    try {
      const res = await fetch(`${LEADERBOARD_URL}/top?limit=${limit}`);
      if (res.ok) return await res.json();
    } catch (_) { /* offline */ }
  }
  return readLocalTop().slice(0, limit);
}

export const isRemoteConfigured = () => !!LEADERBOARD_URL;
