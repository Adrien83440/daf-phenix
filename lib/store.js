// ============================================================================
//  Stockage partagé : clients (accès émis), révocations, quotas, activité.
//
//  Deux moteurs, même interface (toutes les fonctions sont asynchrones) :
//   - "kv"     : Upstash Redis (marketplace Vercel) via son API REST (aucune
//                dépendance npm). Activé dès que KV_REST_API_URL et KV_REST_API_TOKEN
//                (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) existent,
//                avec ou sans préfixe ajouté par Vercel (ex. dafphenix_KV_REST_API_URL).
//   - "memory" : repli en mémoire d'instance quand rien n'est configuré. Les
//                quotas et l'activité repartent de zéro à chaque redémarrage,
//                la liste des clients n'est pas conservée : l'admin le signale.
//
//  Clés Redis :
//    daf:clients                 hash  code -> fiche client (JSON)
//    daf:revoked                 set   codes révoqués depuis l'admin
//    daf:runs:{jour}:{code}      set   identifiants de sessions du jour (quota), expire après 2 jours
//    daf:day:{jour}              hash  compteurs du jour par produit : pro:calls, pro:runs, pro:in, pro:out, pro:cache_read, pro:cache_write, pro:errors, idem perso
//    daf:client:{code}           hash  compteurs cumulés du client : calls, runs, in, out, cache_read, cache_write, errors, last_seen, last_action
//    daf:events                  list  derniers événements (JSON), 1 000 au plus
//    daf:admins                  hash  email -> hash de mot de passe (comptes créés ou modifiés depuis la console)
//    daf:logins                  hash  email -> code (comptes utilisateurs des outils, voir lib/accounts.js)
// ============================================================================
"use strict";

// Le marketplace Vercel peut préfixer les variables (ex. dafphenix_KV_REST_API_URL) :
// on accepte KV_REST_API_URL / UPSTASH_REDIS_REST_URL avec n'importe quel préfixe.
function findEnv(suffixes) {
  const keys = Object.keys(process.env);
  for (let i = 0; i < suffixes.length; i++) {
    if (process.env[suffixes[i]]) return process.env[suffixes[i]];
    const k = keys.find(function (key) { return key.endsWith("_" + suffixes[i]) && process.env[key]; });
    if (k) return process.env[k];
  }
  return "";
}
const KV_URL = findEnv(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]);
const KV_TOKEN = findEnv(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"]);
const EVENTS_MAX = 1000;
const STAT_FIELDS = ["calls", "runs", "in", "out", "cache_read", "cache_write", "errors"];

function today() { return new Date().toISOString().slice(0, 10); }
function dayList(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); out.push(d.toISOString().slice(0, 10)); }
  return out;
}
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function emptyStats() { const o = {}; STAT_FIELDS.forEach(function (f) { o[f] = 0; }); return o; }

// ---------------------------------------------------------------------------
//  Moteur mémoire
// ---------------------------------------------------------------------------
const mem = { clients: new Map(), revoked: new Set(), runs: new Map(), days: new Map(), clientStats: new Map(), events: [], admins: new Map(), logins: new Map() };
function memHash(map, key) { let h = map.get(key); if (!h) { h = {}; map.set(key, h); } return h; }

// ---------------------------------------------------------------------------
//  Moteur KV (Upstash REST)
// ---------------------------------------------------------------------------
async function kv(cmd) {
  const r = await fetch(KV_URL, { method: "POST", headers: { authorization: "Bearer " + KV_TOKEN, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error("KV : " + j.error);
  return j.result;
}
async function kvPipe(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(KV_URL.replace(/\/$/, "") + "/pipeline", { method: "POST", headers: { authorization: "Bearer " + KV_TOKEN, "content-type": "application/json" }, body: JSON.stringify(cmds) });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error("KV : " + ((j && j.error) || "réponse inattendue"));
  return j.map(function (x) { if (x.error) throw new Error("KV : " + x.error); return x.result; });
}
function hashToObj(arr) { const o = {}; for (let i = 0; i + 1 < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; }

// ---------------------------------------------------------------------------
//  Interface
// ---------------------------------------------------------------------------
function backend() { return KV_URL && KV_TOKEN ? "kv" : "memory"; }

async function saveClient(rec) {
  rec = Object.assign({}, rec, { code: String(rec.code).toUpperCase() });
  if (backend() === "kv") await kv(["HSET", "daf:clients", rec.code, JSON.stringify(rec)]);
  else mem.clients.set(rec.code, rec);
  return rec;
}
async function getClient(code) {
  code = String(code || "").toUpperCase();
  if (backend() === "kv") { try { const s = await kv(["HGET", "daf:clients", code]); return s ? JSON.parse(s) : null; } catch (e) { /* repli mémoire */ } }
  return mem.clients.get(code) || null;
}
async function listClients() {
  if (backend() === "kv") { const h = hashToObj(await kv(["HGETALL", "daf:clients"])); return Object.keys(h).map(function (k) { return JSON.parse(h[k]); }); }
  return Array.from(mem.clients.values());
}
async function deleteClient(code) {
  code = String(code || "").toUpperCase();
  if (backend() === "kv") await kvPipe([["HDEL", "daf:clients", code], ["DEL", "daf:client:" + code]]);
  else { mem.clients.delete(code); mem.clientStats.delete(code); }
}

async function setRevoked(code, on) {
  code = String(code || "").toUpperCase();
  if (backend() === "kv") await kv([on ? "SADD" : "SREM", "daf:revoked", code]);
  else if (on) mem.revoked.add(code); else mem.revoked.delete(code);
}
async function isRevoked(code) {
  code = String(code || "").toUpperCase();
  if (backend() === "kv") { try { return !!(await kv(["SISMEMBER", "daf:revoked", code])); } catch (e) { /* repli mémoire */ } }
  return mem.revoked.has(code);
}
async function revokedList() {
  if (backend() === "kv") return await kv(["SMEMBERS", "daf:revoked"]) || [];
  return Array.from(mem.revoked);
}

// Quota : un identifiant de session (runId) compte pour une analyse ; le même
// runId (lecture + cinq analyses d'un audit complet) n'est compté qu'une fois.
async function consumeRun(product, code, runId, limit) {
  code = String(code || "").toUpperCase();
  runId = String(runId || "") || ("R" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const key = "daf:runs:" + today() + ":" + code;
  if (backend() === "kv") {
    try {
      const r = await kvPipe([["SADD", key, runId], ["SCARD", key], ["EXPIRE", key, 172800]]);
      const added = r[0] === 1, used = num(r[1]);
      if (added && used > limit) { await kv(["SREM", key, runId]); return { ok: false, used: used - 1, limit: limit }; }
      if (added) await kvPipe([["HINCRBY", "daf:day:" + today(), product + ":runs", 1], ["HINCRBY", "daf:client:" + code, "runs", 1]]);
      return { ok: true, used: used, limit: limit };
    } catch (e) { /* repli mémoire : le client n'est jamais bloqué par une panne du stockage */ }
  }
  let set = mem.runs.get(key); if (!set) { set = new Set(); mem.runs.set(key, set); }
  if (set.has(runId)) return { ok: true, used: set.size, limit: limit };
  if (set.size >= limit) return { ok: false, used: set.size, limit: limit };
  set.add(runId);
  memHash(mem.days, today())[product + ":runs"] = num(memHash(mem.days, today())[product + ":runs"]) + 1;
  memHash(mem.clientStats, code).runs = num(memHash(mem.clientStats, code).runs) + 1;
  if (mem.runs.size > 5000) mem.runs.clear();
  return { ok: true, used: set.size, limit: limit };
}
async function quotaUsed(code) {
  code = String(code || "").toUpperCase();
  const key = "daf:runs:" + today() + ":" + code;
  if (backend() === "kv") { try { return num(await kv(["SCARD", key])); } catch (e) { /* repli mémoire */ } }
  const set = mem.runs.get(key); return set ? set.size : 0;
}

// Activité : un événement par appel IA (lecture ou analyse), réussi ou non.
async function record(ev) {
  const code = String(ev.code || "").toUpperCase(), product = ev.product || "pro", day = today();
  const u = ev.usage || {};
  const inc = { calls: 1, in: num(u.input_tokens), out: num(u.output_tokens), cache_read: num(u.cache_read_input_tokens), cache_write: num(u.cache_creation_input_tokens), errors: ev.ok ? 0 : 1 };
  const event = { t: new Date().toISOString(), product: product, code: code, label: ev.label || "", action: ev.action || "", module: ev.module || "", ok: !!ev.ok, ms: num(ev.ms), in: inc.in, out: inc.out, cache_read: inc.cache_read, cache_write: inc.cache_write, error: ev.ok ? "" : String(ev.error || "").slice(0, 160) };
  if (backend() === "kv") {
    const cmds = [["LPUSH", "daf:events", JSON.stringify(event)], ["LTRIM", "daf:events", 0, EVENTS_MAX - 1], ["HSET", "daf:client:" + code, "last_seen", event.t, "last_action", (event.action + (event.module ? ":" + event.module : ""))]];
    Object.keys(inc).forEach(function (f) { if (inc[f]) { cmds.push(["HINCRBY", "daf:day:" + day, product + ":" + f, inc[f]]); cmds.push(["HINCRBY", "daf:client:" + code, f, inc[f]]); } });
    try { await kvPipe(cmds); return; } catch (e) { /* repli mémoire */ }
  }
  mem.events.unshift(event); if (mem.events.length > EVENTS_MAX) mem.events.length = EVENTS_MAX;
  const d = memHash(mem.days, day), c = memHash(mem.clientStats, code);
  Object.keys(inc).forEach(function (f) { if (inc[f]) { d[product + ":" + f] = num(d[product + ":" + f]) + inc[f]; c[f] = num(c[f]) + inc[f]; } });
  c.last_seen = event.t; c.last_action = event.action + (event.module ? ":" + event.module : "");
}

// Exécute un appel IA en le journalisant (succès ou échec, durée, jetons).
async function traced(info, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    await record(Object.assign({}, info, { ok: true, ms: Date.now() - t0, usage: out && out.usage }));
    return out;
  } catch (e) {
    await record(Object.assign({}, info, { ok: false, ms: Date.now() - t0, error: e && e.message }));
    throw e;
  }
}

async function events(n) {
  n = Math.max(1, Math.min(EVENTS_MAX, parseInt(n, 10) || 50));
  if (backend() === "kv") return (await kv(["LRANGE", "daf:events", 0, n - 1]) || []).map(function (s) { return JSON.parse(s); });
  return mem.events.slice(0, n);
}
async function dayStats(n) {
  const days = dayList(Math.max(1, Math.min(90, n || 30)));
  let hashes;
  if (backend() === "kv") hashes = (await kvPipe(days.map(function (d) { return ["HGETALL", "daf:day:" + d]; }))).map(hashToObj);
  else hashes = days.map(function (d) { return mem.days.get(d) || {}; });
  return days.map(function (d, i) {
    const h = hashes[i] || {}, out = { date: d, pro: emptyStats(), perso: emptyStats() };
    Object.keys(h).forEach(function (k) { const p = k.split(":"); if (out[p[0]] && p[1] in out[p[0]]) out[p[0]][p[1]] = num(h[k]); });
    return out;
  });
}
async function clientStats(codes) {
  codes = (codes || []).map(function (c) { return String(c).toUpperCase(); });
  let hashes;
  if (backend() === "kv") hashes = (await kvPipe(codes.map(function (c) { return ["HGETALL", "daf:client:" + c]; }))).map(hashToObj);
  else hashes = codes.map(function (c) { return mem.clientStats.get(c) || {}; });
  const out = {};
  codes.forEach(function (c, i) {
    const h = hashes[i] || {}, s = emptyStats();
    STAT_FIELDS.forEach(function (f) { s[f] = num(h[f]); });
    s.last_seen = h.last_seen || ""; s.last_action = h.last_action || "";
    out[c] = s;
  });
  return out;
}

// Comptes de la console (e-mail -> hash), en plus de ceux de la variable DAF_ADMINS.
async function getAdmins() {
  if (backend() === "kv") { try { return hashToObj(await kv(["HGETALL", "daf:admins"])); } catch (e) { /* repli mémoire */ } }
  const o = {}; mem.admins.forEach(function (v, k) { o[k] = v; }); return o;
}
async function setAdmin(email, hash) {
  if (backend() === "kv") { await kv(["HSET", "daf:admins", email, hash]); return; }
  mem.admins.set(email, hash);
}
async function deleteAdmin(email) {
  if (backend() === "kv") { await kv(["HDEL", "daf:admins", email]); return; }
  mem.admins.delete(email);
}

// Comptes utilisateurs des outils : e-mail -> code
async function setLogin(email, code) {
  if (backend() === "kv") { await kv(["HSET", "daf:logins", email, String(code).toUpperCase()]); return; }
  mem.logins.set(email, String(code).toUpperCase());
}
async function getLoginCode(email) {
  if (backend() === "kv") { try { return (await kv(["HGET", "daf:logins", email])) || ""; } catch (e) { /* repli mémoire */ } }
  return mem.logins.get(email) || "";
}
async function deleteLogin(email) {
  if (backend() === "kv") { await kv(["HDEL", "daf:logins", email]); return; }
  mem.logins.delete(email);
}

async function ping() {
  if (backend() !== "kv") return { backend: "memory", ok: true };
  try { const r = await kv(["PING"]); return { backend: "kv", ok: r === "PONG" }; }
  catch (e) { return { backend: "kv", ok: false, error: e.message }; }
}

function _reset() { mem.clients.clear(); mem.revoked.clear(); mem.runs.clear(); mem.days.clear(); mem.clientStats.clear(); mem.events.length = 0; mem.admins.clear(); mem.logins.clear(); }

module.exports = { backend, today, dayList, saveClient, getClient, listClients, deleteClient, setRevoked, isRevoked, revokedList, consumeRun, quotaUsed, record, traced, events, dayStats, clientStats, getAdmins, setAdmin, deleteAdmin, setLogin, getLoginCode, deleteLogin, ping, STAT_FIELDS, _reset };
