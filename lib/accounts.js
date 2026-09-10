// ============================================================================
//  Comptes utilisateurs (e-mail + mot de passe) pour les outils Pro et Perso.
//
//  Un compte n'est qu'une porte d'entrée vers un code d'accès : la fiche
//  client (lib/store.js, daf:clients) porte passwordHash et mustChange, et
//  l'index daf:logins fait e-mail -> code. Après connexion, l'outil reçoit le
//  code et l'utilise comme aujourd'hui (quota, expiration, révocation), sans
//  jamais l'afficher. Le stockage KV est requis : sans lui, un compte
//  disparaîtrait au redémarrage de la fonction (DAF_ACCOUNTS_MEMORY_OK=1 lève
//  cette garde pour les tests).
// ============================================================================
"use strict";
const store = require("./store.js");
const auth = require("./auth.js");

const WORDS = ["phenix", "budget", "tresor", "flamme", "aurore", "sommet", "cap", "plan", "score", "elan", "boussole", "relais", "sillage", "horizon", "atout", "levier"];
function provisionalPassword() {
  const pick = function () { return WORDS[Math.floor(Math.random() * WORDS.length)]; };
  return pick() + "-" + pick() + "-" + Math.floor(1000 + Math.random() * 9000);
}
function canPersist() { return store.backend() === "kv" || process.env.DAF_ACCOUNTS_MEMORY_OK === "1"; }
function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

// Rattache un compte (mot de passe provisoire ou définitif) à une fiche client.
async function setPassword(code, password, provisional) {
  if (!canPersist()) throw new Error("Les comptes e-mail demandent le stockage KV (Vercel → Storage → KV). En attendant, donne un code d'accès.");
  const rec = await store.getClient(code);
  if (!rec) throw new Error("Client inconnu.");
  const email = auth.normEmail(rec.email);
  if (!validEmail(email)) throw new Error("La fiche n'a pas d'adresse e-mail valide.");
  const other = await store.getLoginCode(email);
  if (other && other !== rec.code) {
    const o = await store.getClient(other);
    if (o && !o.replacedBy) throw new Error("Cette adresse est déjà rattachée à un autre accès (" + other + ").");
  }
  const next = Object.assign({}, rec, { email: email, passwordHash: auth.hashPassword(password), mustChange: !!provisional, passwordSetAt: new Date().toISOString() });
  await store.saveClient(next);
  await store.setLogin(email, rec.code);
  return next;
}

// Déplace le compte d'un code vers un autre (prolongation) ; l'e-mail peut changer (fiche modifiée).
async function moveLogin(oldRec, newRec) {
  const oldEmail = auth.normEmail(oldRec && oldRec.email), newEmail = auth.normEmail(newRec && newRec.email);
  if (oldEmail && oldEmail !== newEmail) await store.deleteLogin(oldEmail);
  if (newEmail && newRec.passwordHash) await store.setLogin(newEmail, newRec.code);
}

// Connexion d'un utilisateur : renvoie le code valide ou une erreur lisible.
// checkCode : vérificateur du produit appelant (Pro ou Perso).
async function login(body, ip, checkCode) {
  if (auth.loginBlocked(ip)) return { status: 429, out: { ok: false, error: "Trop de tentatives. Réessaie dans un quart d'heure." } };
  const email = auth.normEmail(body.email);
  const code = email ? await store.getLoginCode(email) : "";
  const rec = code ? await store.getClient(code) : null;
  if (!rec || !rec.passwordHash || !auth.verifyPassword(body.password, rec.passwordHash)) {
    auth.loginFailed(ip);
    return { status: 401, out: { ok: false, error: "E-mail ou mot de passe incorrect." } };
  }
  auth.loginSucceeded(ip);
  const chk = checkCode(rec.code);
  if (!chk.ok) return { status: 401, out: { ok: false, error: chk.error } };
  if (await store.isRevoked(rec.code)) return { status: 401, out: { ok: false, error: "Cet accès a été désactivé." } };
  return { status: 200, out: { ok: true, code: rec.code, label: rec.name || chk.label, expires: chk.expires, product: chk.product || rec.product, email: email, mustChange: !!rec.mustChange } };
}

// Changement de mot de passe par l'utilisateur (première connexion ou plus tard).
async function changePassword(body, ip) {
  if (auth.loginBlocked(ip)) return { status: 429, out: { ok: false, error: "Trop de tentatives. Réessaie dans un quart d'heure." } };
  const email = auth.normEmail(body.email);
  const code = email ? await store.getLoginCode(email) : "";
  const rec = code ? await store.getClient(code) : null;
  if (!rec || !rec.passwordHash || !auth.verifyPassword(body.current, rec.passwordHash)) { auth.loginFailed(ip); return { status: 401, out: { ok: false, error: "Mot de passe actuel incorrect." } }; }
  let hash;
  try { hash = auth.hashPassword(body.password); } catch (e) { return { status: 400, out: { ok: false, error: e.message } }; }
  if (auth.verifyPassword(body.password, rec.passwordHash)) return { status: 400, out: { ok: false, error: "Choisis un mot de passe différent du provisoire." } };
  await store.saveClient(Object.assign({}, rec, { passwordHash: hash, mustChange: false, passwordSetAt: new Date().toISOString() }));
  return { status: 200, out: { ok: true, email: email } };
}

module.exports = { provisionalPassword, canPersist, validEmail, setPassword, moveLogin, login, changePassword };
