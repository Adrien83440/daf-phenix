// ============================================================================
//  Authentification de la console : comptes e-mail + mot de passe, sessions signées.
//
//  Comptes : variable DAF_ADMINS = "email:hash,email2:hash2" (hash produit par
//  `npm run admin:hash -- email motdepasse`) et, si Vercel KV est branché, les
//  comptes créés ou modifiés depuis la console (lib/store.js, clé daf:admins),
//  qui priment sur la variable pour la même adresse.
//
//  Mot de passe : scrypt (N = 16384, r = 8, p = 1), sel aléatoire, format
//  "scrypt$<sel base64url>$<hash base64url>". Comparaison à temps constant.
//
//  Session : jeton "<charge base64url>.<signature base64url>", charge JSON
//  { e: email, exp: expiration en ms }, signature HMAC-SHA256 avec
//  DAF_SESSION_SECRET, sinon DAF_ACCESS_SECRET, sinon DAF_ADMIN_KEY. Durée : 12 h.
// ============================================================================
"use strict";
const crypto = require("crypto");

const SESSION_HOURS = 12;
const LOGIN_MAX_FAILS = 8;        // tentatives ratées par IP…
const LOGIN_WINDOW_MS = 15 * 60000; // …par quart d'heure

function secret() { return process.env.DAF_SESSION_SECRET || process.env.DAF_ACCESS_SECRET || process.env.DAF_ADMIN_KEY || ""; }
function b64u(buf) { return Buffer.from(buf).toString("base64url"); }
function normEmail(e) { return String(e || "").trim().toLowerCase(); }

function hashPassword(password) {
  const pwd = String(password || "");
  if (pwd.length < 8) throw new Error("Mot de passe trop court (8 caractères minimum).");
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pwd, salt, 32, { N: 16384, r: 8, p: 1 });
  return "scrypt$" + b64u(salt) + "$" + b64u(hash);
}
function verifyPassword(password, stored) {
  const p = String(stored || "").split("$");
  if (p.length !== 3 || p[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(p[1], "base64url"), expected = Buffer.from(p[2], "base64url");
    const hash = crypto.scryptSync(String(password || ""), salt, expected.length, { N: 16384, r: 8, p: 1 });
    return expected.length > 0 && crypto.timingSafeEqual(hash, expected);
  } catch (e) { return false; }
}

// Comptes déclarés par variable d'environnement : { email: hash }
function envAdmins() {
  const out = {};
  String(process.env.DAF_ADMINS || "").split(",").forEach(function (s) {
    const i = s.indexOf(":");
    if (i < 1) return;
    const email = normEmail(s.slice(0, i)), hash = s.slice(i + 1).trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && /^scrypt\$/.test(hash)) out[email] = hash;
  });
  return out;
}

function signSession(email, hours) {
  if (!secret()) throw new Error("Aucun secret de session (DAF_SESSION_SECRET, DAF_ACCESS_SECRET ou DAF_ADMIN_KEY).");
  const payload = b64u(JSON.stringify({ e: normEmail(email), exp: Date.now() + (hours || SESSION_HOURS) * 3600000 }));
  const sig = b64u(crypto.createHmac("sha256", secret()).update(payload).digest());
  return payload + "." + sig;
}
function verifySession(token) {
  const t = String(token || "").split(".");
  if (t.length !== 2 || !secret()) return null;
  const sig = crypto.createHmac("sha256", secret()).update(t[0]).digest();
  let given;
  try { given = Buffer.from(t[1], "base64url"); } catch (e) { return null; }
  if (given.length !== sig.length || !crypto.timingSafeEqual(given, sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(t[0], "base64url").toString("utf8"));
    if (!p.e || !p.exp || Date.now() > p.exp) return null;
    return { email: p.e, exp: p.exp };
  } catch (e) { return null; }
}

// Limitation des tentatives de connexion (mémoire d'instance)
const fails = new Map(); // ip -> [timestamps]
function loginBlocked(ip) {
  const now = Date.now(), arr = (fails.get(ip) || []).filter(function (t) { return now - t < LOGIN_WINDOW_MS; });
  fails.set(ip, arr);
  if (fails.size > 5000) fails.clear();
  return arr.length >= LOGIN_MAX_FAILS;
}
function loginFailed(ip) { const arr = fails.get(ip) || []; arr.push(Date.now()); fails.set(ip, arr); }
function loginSucceeded(ip) { fails.delete(ip); }

module.exports = { hashPassword, verifyPassword, envAdmins, normEmail, signSession, verifySession, loginBlocked, loginFailed, loginSucceeded, SESSION_HOURS };
