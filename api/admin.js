// ============================================================================
//  Console d'administration — fonction serveur (Vercel, Node CommonJS)
//  Sert admin.html : vue d'ensemble, clients Pro et Perso, accès (création,
//  prolongation, révocation), activité et coût. S'appuie sur lib/store.js
//  (Vercel KV si configuré, sinon mémoire d'instance).
//
//  Authentification, au choix :
//   - e-mail + mot de passe (action login) → jeton de session 12 h, passé ensuite
//     dans le corps (adminToken) ou l'en-tête X-Admin-Token ; comptes dans
//     DAF_ADMINS (npm run admin:hash) et/ou créés depuis la console (KV) ;
//   - DAF_ADMIN_KEY dans le corps (adminKey) ou l'en-tête X-Admin-Key (secours,
//     et appels serveur à serveur).
//  Variables facultatives : DAF_SESSION_SECRET (signe les sessions ; sinon
//  DAF_ACCESS_SECRET), DAF_PRICE_IN, DAF_PRICE_OUT (dollars par million de
//  jetons, défaut 2 et 10) pour l'estimation de coût.
//
//  Actions (POST JSON) : login | me | password | admins | admin_set | admin_delete |
//                        overview | clients | mint | import | update | extend |
//                        revoke | unrevoke | delete | verify | events
// ============================================================================
"use strict";
const pro = require("./daf.js");
const perso = require("./perso.js");
const store = require("../lib/store.js");
const auth = require("../lib/auth.js");
const P = pro._internal, X = perso._internal;

const ADMIN_KEY = process.env.DAF_ADMIN_KEY || "";
const PRICE_IN = parseFloat(process.env.DAF_PRICE_IN || "2") || 2;
const PRICE_OUT = parseFloat(process.env.DAF_PRICE_OUT || "10") || 10;
const SOON_DAYS = 15;

function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).end(JSON.stringify(payload));
}
function envList(name) { return String(process.env[name] || "").split(",").map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean); }
function productOf(code) { return /^PXP-/i.test(String(code || "")) ? "perso" : "pro"; }
function checkAny(code) {
  const c = String(code || "").trim().toUpperCase();
  if (productOf(c) === "perso") return Object.assign({ product: "perso" }, X.checkCode(c));
  const r = P.checkCode(c);
  return Object.assign({ product: "pro" }, r);
}
function status(rec, revokedSet, todayStr) {
  if (rec.replacedBy) return "remplace";
  if (revokedSet.has(rec.code) || envList(rec.product === "perso" ? "PERSO_REVOKED" : "DAF_REVOKED").indexOf(rec.tag) > -1) return "revoque";
  if (rec.expires && todayStr > rec.expires) return "expire";
  if (rec.expires) {
    const days = Math.round((new Date(rec.expires + "T23:59:59Z").getTime() - Date.now()) / 864e5);
    if (days <= SOON_DAYS) return "bientot";
  }
  return "actif";
}
function cost(s) {
  // s : { in, out, cache_read, cache_write } en jetons ; résultat en dollars
  return ((s.in || 0) * PRICE_IN + (s.out || 0) * PRICE_OUT + (s.cache_read || 0) * PRICE_IN * 0.1 + (s.cache_write || 0) * PRICE_IN * 1.25) / 1e6;
}
function clean(body, allowed) {
  const out = {};
  allowed.forEach(function (k) { if (body[k] !== undefined && body[k] !== null) out[k] = String(body[k]).trim(); });
  return out;
}
function mint(product, name, months) { return product === "perso" ? X.mintCode(name, months) : P.mintCode(name, months); }
function newRecord(product, m, body, source) {
  return {
    code: m.code, product: product, tag: m.label, name: String(body.name || "").trim().slice(0, 80), email: String(body.email || "").trim().slice(0, 120),
    note: String(body.note || "").trim().slice(0, 500), quota: parseInt(body.quota, 10) > 0 ? parseInt(body.quota, 10) : 0,
    months: parseInt(body.months, 10) || (product === "perso" ? 1 : 12), created: new Date().toISOString(), expires: m.expires, source: source
  };
}

async function clientsMerged() {
  const todayStr = store.today();
  const recs = await store.listClients();
  const revokedSet = new Set(await store.revokedList());
  const ev = await store.events(1000);
  const known = new Set(recs.map(function (r) { return r.code; }));
  const others = {};
  // Codes vus dans l'activité mais sans fiche (Academy, codes fixes, codes antérieurs à la console) ;
  // un code révoqué sans fiche est un client supprimé : on ne le fait pas réapparaître.
  ev.forEach(function (e) { if (e.code && !known.has(e.code) && !revokedSet.has(e.code)) { const o = others[e.code] || (others[e.code] = { code: e.code, product: e.product, tag: e.label || e.code, name: e.label || "", unregistered: true }); if (!o.lastSeen || e.t > o.lastSeen) o.lastSeen = e.t; } });
  const all = recs.concat(Object.keys(others).map(function (k) { return others[k]; }));
  const stats = await store.clientStats(all.map(function (r) { return r.code; }));
  const used = await Promise.all(all.map(function (r) { return store.quotaUsed(r.code); }));
  return all.map(function (r, i) {
    const s = stats[r.code] || {};
    return Object.assign({}, r, {
      status: r.unregistered ? (r.code === "ACADEMY" ? "academy" : "inconnu") : status(r, revokedSet, todayStr),
      revoked: revokedSet.has(r.code), usedToday: used[i], stats: s, cost: cost(s),
      limit: parseInt(r.quota, 10) > 0 ? parseInt(r.quota, 10) : (r.product === "perso" ? X.QUOTA : P.QUOTA)
    });
  }).sort(function (a, b) { return String(b.created || b.lastSeen || "").localeCompare(String(a.created || a.lastSeen || "")); });
}

async function allAdmins() { return Object.assign({}, auth.envAdmins(), await store.getAdmins()); }
async function login(body, ip) {
  if (auth.loginBlocked(ip)) return { status: 429, out: { ok: false, error: "Trop de tentatives. Réessaie dans un quart d'heure." } };
  const email = auth.normEmail(body.email), admins = await allAdmins();
  if (!email || !admins[email] || !auth.verifyPassword(body.password, admins[email])) {
    auth.loginFailed(ip);
    return { status: 401, out: { ok: false, error: "E-mail ou mot de passe incorrect." } };
  }
  auth.loginSucceeded(ip);
  return { status: 200, out: { ok: true, token: auth.signSession(email), email: email, expiresIn: auth.SESSION_HOURS * 3600 } };
}

async function overview() {
  const days = await store.dayStats(30);
  const sum = function (list) { const t = { runs: 0, calls: 0, errors: 0, in: 0, out: 0, cache_read: 0, cache_write: 0, pro_runs: 0, perso_runs: 0 }; list.forEach(function (d) { ["pro", "perso"].forEach(function (p) { t.runs += d[p].runs; t.calls += d[p].calls; t.errors += d[p].errors; t.in += d[p].in; t.out += d[p].out; t.cache_read += d[p].cache_read; t.cache_write += d[p].cache_write; t[p + "_runs"] += d[p].runs; }); }); t.cost = cost(t); return t; };
  const clients = await clientsMerged();
  const byProduct = { pro: {}, perso: {} };
  clients.forEach(function (c) { const p = byProduct[c.product] || (byProduct[c.product] = {}); p[c.status] = (p[c.status] || 0) + 1; p.total = (p.total || 0) + 1; });
  return {
    config: {
      model: P.MODEL, effort: P.EFFORT, quotaPro: P.QUOTA, quotaPerso: X.QUOTA,
      configured: { api: !!process.env.ANTHROPIC_API_KEY, secret: !!process.env.DAF_ACCESS_SECRET, admin: !!ADMIN_KEY, bridge: !!process.env.DAF_BRIDGE_KEY, admins: Object.keys(auth.envAdmins()).length, sessionSecret: !!process.env.DAF_SESSION_SECRET },
      store: await store.ping(), prices: { in: PRICE_IN, out: PRICE_OUT },
      revokedEnv: { pro: envList("DAF_REVOKED"), perso: envList("PERSO_REVOKED") },
      staticCodes: { pro: envList("DAF_ACCESS_CODES").map(function (s) { return s.split(":")[0]; }), perso: envList("PERSO_ACCESS_CODES").map(function (s) { return s.split(":")[0]; }) },
      region: process.env.VERCEL_REGION || "", env: process.env.VERCEL_ENV || "local"
    },
    totals: { today: sum(days.slice(-1)), d7: sum(days.slice(-7)), d30: sum(days), clients: byProduct },
    days: days, events: await store.events(25)
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { send(res, 405, { ok: false, error: "POST uniquement" }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") { send(res, 400, { ok: false, error: "Corps JSON attendu" }); return; }
  const ip = String(req.headers["x-forwarded-for"] || req.socket && req.socket.remoteAddress || "?").split(",")[0].trim();
  if (P.rateLimited(ip)) { send(res, 429, { ok: false, error: "Trop de requêtes. Réessaie dans quelques minutes." }); return; }
  const action = String(body.action || "overview");
  if (action === "login") { try { const r = await login(body, ip); send(res, r.status, r.out); } catch (e) { send(res, 500, { ok: false, error: String(e.message || e) }); } return; }

  // Session (e-mail + mot de passe) ou clé admin
  const session = auth.verifySession(body.adminToken || req.headers["x-admin-token"]);
  const key = String(body.adminKey || req.headers["x-admin-key"] || "");
  const byKey = !!ADMIN_KEY && key === ADMIN_KEY;
  if (!session && !byKey) { send(res, 401, { ok: false, error: session === null && (body.adminToken || req.headers["x-admin-token"]) ? "Session expirée, reconnecte-toi." : "Connexion requise." }); return; }
  const who = session ? session.email : "clé admin";

  try {
    if (action === "me") { const admins = await allAdmins(); send(res, 200, { ok: true, email: session ? session.email : "", byKey: byKey, exp: session ? session.exp : 0, accounts: Object.keys(admins).length, canPersist: store.backend() === "kv" }); return; }

    if (action === "password") {
      // Change le mot de passe du compte connecté (ou en crée un depuis la clé admin).
      const email = auth.normEmail(session ? session.email : body.email);
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { send(res, 400, { ok: false, error: "Adresse e-mail invalide." }); return; }
      const admins = await allAdmins();
      if (session && !auth.verifyPassword(body.current, admins[email] || "")) { send(res, 401, { ok: false, error: "Mot de passe actuel incorrect." }); return; }
      let hash;
      try { hash = auth.hashPassword(body.password); } catch (e) { send(res, 400, { ok: false, error: e.message }); return; }
      const persisted = store.backend() === "kv";
      await store.setAdmin(email, hash);
      send(res, 200, { ok: true, email: email, persisted: persisted, envLine: persisted ? "" : email + ":" + hash, token: auth.signSession(email) });
      return;
    }

    if (action === "admins") {
      const env = auth.envAdmins(), kvA = await store.getAdmins();
      const list = Object.keys(Object.assign({}, env, kvA)).sort().map(function (e) { return { email: e, source: kvA[e] ? "console" : "variable" }; });
      send(res, 200, { ok: true, admins: list, canPersist: store.backend() === "kv" });
      return;
    }
    if (action === "admin_set") {
      const email = auth.normEmail(body.email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { send(res, 400, { ok: false, error: "Adresse e-mail invalide." }); return; }
      let hash;
      try { hash = auth.hashPassword(body.password); } catch (e) { send(res, 400, { ok: false, error: e.message }); return; }
      await store.setAdmin(email, hash);
      send(res, 200, { ok: true, email: email, persisted: store.backend() === "kv", envLine: store.backend() === "kv" ? "" : email + ":" + hash });
      return;
    }
    if (action === "admin_delete") {
      const email = auth.normEmail(body.email);
      if (session && email === session.email) { send(res, 400, { ok: false, error: "Tu ne peux pas supprimer ton propre compte." }); return; }
      await store.deleteAdmin(email);
      send(res, 200, { ok: true, email: email, stillInEnv: !!auth.envAdmins()[email] });
      return;
    }

    if (action === "overview") { send(res, 200, Object.assign({ ok: true }, await overview())); return; }
    if (action === "clients") { send(res, 200, { ok: true, clients: await clientsMerged(), backend: store.backend() }); return; }
    if (action === "events") { send(res, 200, { ok: true, events: await store.events(body.n || 200) }); return; }

    if (action === "mint") {
      const product = body.product === "perso" ? "perso" : "pro";
      if (!process.env.DAF_ACCESS_SECRET) { send(res, 500, { ok: false, error: "DAF_ACCESS_SECRET manquant côté serveur." }); return; }
      const m = mint(product, body.name, body.months);
      const rec = await store.saveClient(newRecord(product, m, body, "admin:" + who));
      send(res, 200, { ok: true, client: rec, code: m.code, expires: m.expires, product: product });
      return;
    }

    if (action === "import") {
      // Enregistre un code déjà émis (avant la console, ou par l'API) pour le suivre.
      const chk = checkAny(body.code);
      if (!chk.ok) { send(res, 400, { ok: false, error: chk.error || "Code invalide." }); return; }
      const existing = await store.getClient(chk.code);
      const rec = await store.saveClient(Object.assign({ created: new Date().toISOString(), source: "import" }, existing || {}, { code: chk.code, product: chk.product, tag: chk.label, expires: chk.expires || "" }, clean(body, ["name", "email", "note"]), body.quota !== undefined ? { quota: parseInt(body.quota, 10) > 0 ? parseInt(body.quota, 10) : 0 } : {}));
      send(res, 200, { ok: true, client: rec });
      return;
    }

    if (action === "update") {
      const rec = await store.getClient(body.code);
      if (!rec) { send(res, 404, { ok: false, error: "Client inconnu." }); return; }
      const upd = clean(body, ["name", "email", "note"]);
      if (body.quota !== undefined) upd.quota = parseInt(body.quota, 10) > 0 ? parseInt(body.quota, 10) : 0;
      send(res, 200, { ok: true, client: await store.saveClient(Object.assign({}, rec, upd)) });
      return;
    }

    if (action === "extend") {
      // Nouveau code, même client : l'ancien est marqué remplacé et révoqué.
      const rec = await store.getClient(body.code);
      if (!rec) { send(res, 404, { ok: false, error: "Client inconnu." }); return; }
      const m = mint(rec.product, rec.name || rec.tag, body.months || rec.months);
      const next = await store.saveClient(Object.assign({}, rec, { code: m.code, tag: m.label, expires: m.expires, months: parseInt(body.months, 10) || rec.months, created: new Date().toISOString(), source: "extend", replaces: rec.code, replacedBy: "" }));
      await store.saveClient(Object.assign({}, rec, { replacedBy: m.code }));
      await store.setRevoked(rec.code, true);
      send(res, 200, { ok: true, client: next, code: m.code, expires: m.expires, product: rec.product });
      return;
    }

    if (action === "revoke" || action === "unrevoke") {
      const code = String(body.code || "").trim().toUpperCase();
      if (!code) { send(res, 400, { ok: false, error: "Code manquant." }); return; }
      await store.setRevoked(code, action === "revoke");
      send(res, 200, { ok: true, code: code, revoked: action === "revoke" });
      return;
    }

    if (action === "delete") {
      const code = String(body.code || "").trim().toUpperCase();
      if (!code) { send(res, 400, { ok: false, error: "Code manquant." }); return; }
      await store.setRevoked(code, true);
      await store.deleteClient(code);
      send(res, 200, { ok: true, code: code });
      return;
    }

    if (action === "verify") {
      const chk = checkAny(body.code);
      const rec = chk.ok ? await store.getClient(chk.code) : null;
      const revoked = chk.ok ? await store.isRevoked(chk.code) : false;
      send(res, 200, Object.assign({ ok: true }, chk, { valid: !!chk.ok && !revoked, revoked: revoked, client: rec, usedToday: chk.ok ? await store.quotaUsed(chk.code) : 0 }));
      return;
    }

    send(res, 400, { ok: false, error: "Action inconnue." });
  } catch (e) {
    send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};

module.exports._internal = { status: status, cost: cost, checkAny: checkAny, clientsMerged: clientsMerged, overview: overview, login: login };
