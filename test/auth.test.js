// Authentification de la console : mots de passe, sessions, connexion, comptes.
"use strict";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.DAF_ACCESS_SECRET = "secret-de-test";
process.env.DAF_ADMIN_KEY = "admin-test";
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../lib/auth.js");
const hashAdrien = auth.hashPassword("mon mot de passe");
process.env.DAF_ADMINS = "Adrien@Exemple.com:" + hashAdrien + ", faux:pasunhash";
const admin = require("../api/admin.js");
const store = require("../lib/store.js");

function call(body, headers, ip) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    admin({ method: "POST", body, headers: Object.assign({ "x-forwarded-for": ip || "10.2.0." + Math.floor(Math.random() * 250) }, headers || {}), socket: {} }, res);
  });
}

test("hachage scrypt : vérification, sel aléatoire, longueur minimale", function () {
  const h = auth.hashPassword("motdepasse1");
  assert.match(h, /^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(auth.verifyPassword("motdepasse1", h), true);
  assert.equal(auth.verifyPassword("motdepasse2", h), false);
  assert.equal(auth.verifyPassword("motdepasse1", "n'importe quoi"), false);
  assert.notEqual(auth.hashPassword("motdepasse1"), h, "sel différent à chaque fois");
  assert.throws(() => auth.hashPassword("court"), /8 caractères/);
});

test("session : signature, expiration, falsification", function () {
  const t = auth.signSession("Adrien@Exemple.com");
  const s = auth.verifySession(t);
  assert.equal(s.email, "adrien@exemple.com");
  assert.ok(s.exp > Date.now() + 11 * 3600000);
  assert.equal(auth.verifySession(t + "x"), null);
  assert.equal(auth.verifySession("abc"), null);
  const parts = t.split("."), forged = Buffer.from(JSON.stringify({ e: "pirate@x.fr", exp: Date.now() + 1e7 })).toString("base64url") + "." + parts[1];
  assert.equal(auth.verifySession(forged), null);
  assert.equal(auth.verifySession(auth.signSession("a@b.fr", -1)), null, "jeton expiré");
});

test("comptes de la variable DAF_ADMINS : normalisation, entrées invalides ignorées", function () {
  const a = auth.envAdmins();
  assert.deepEqual(Object.keys(a), ["adrien@exemple.com"]);
  assert.equal(a["adrien@exemple.com"], hashAdrien);
});

let token;
test("connexion par e-mail et mot de passe", async function () {
  let r = await call({ action: "login", email: "adrien@exemple.com", password: "faux" });
  assert.equal(r.status, 401); assert.match(r.json.error, /incorrect/);
  r = await call({ action: "login", email: "inconnu@exemple.com", password: "mon mot de passe" });
  assert.equal(r.status, 401);
  r = await call({ action: "login", email: " ADRIEN@exemple.com ", password: "mon mot de passe" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.email, "adrien@exemple.com");
  assert.equal(r.json.expiresIn, 12 * 3600);
  token = r.json.token;
});

test("le jeton ouvre la console, dans le corps ou l'en-tête ; la clé reste acceptée", async function () {
  assert.equal((await call({ action: "overview" })).status, 401);
  assert.equal((await call({ action: "overview", adminToken: token })).status, 200);
  assert.equal((await call({ action: "overview" }, { "x-admin-token": token })).status, 200);
  assert.equal((await call({ action: "overview", adminToken: token + "x" })).status, 401);
  assert.match((await call({ action: "overview", adminToken: token + "x" })).json.error, /expirée/);
  assert.equal((await call({ action: "overview", adminKey: "admin-test" })).status, 200);
  const me = (await call({ action: "me", adminToken: token })).json;
  assert.equal(me.email, "adrien@exemple.com"); assert.equal(me.byKey, false); assert.equal(me.accounts, 1); assert.equal(me.canPersist, false);
  const meKey = (await call({ action: "me", adminKey: "admin-test" })).json;
  assert.equal(meKey.byKey, true); assert.equal(meKey.email, "");
  const m = await call({ action: "mint", adminToken: token, product: "pro", name: "Trace", months: 1 });
  assert.equal(m.json.client.source, "admin:adrien@exemple.com", "l'auteur de l'accès est tracé");
});

test("limitation : huit échecs bloquent l'adresse IP un quart d'heure", async function () {
  const ip = "10.3.3.3";
  for (let i = 0; i < 8; i++) await call({ action: "login", email: "adrien@exemple.com", password: "faux" }, {}, ip);
  const r = await call({ action: "login", email: "adrien@exemple.com", password: "mon mot de passe" }, {}, ip);
  assert.equal(r.status, 429); assert.match(r.json.error, /Trop de tentatives/);
  const other = await call({ action: "login", email: "adrien@exemple.com", password: "mon mot de passe" }, {}, "10.3.3.4");
  assert.equal(other.status, 200, "une autre adresse n'est pas bloquée");
});

test("changement de mot de passe : ancien requis, puis connexion avec le nouveau", async function () {
  let r = await call({ action: "password", adminToken: token, current: "faux", password: "nouveau mot de passe" });
  assert.equal(r.status, 401);
  r = await call({ action: "password", adminToken: token, current: "mon mot de passe", password: "court" });
  assert.equal(r.status, 400); assert.match(r.json.error, /8 caractères/);
  r = await call({ action: "password", adminToken: token, current: "mon mot de passe", password: "nouveau mot de passe" });
  assert.equal(r.status, 200);
  assert.equal(r.json.persisted, false, "sans KV : à reporter dans la variable");
  assert.match(r.json.envLine, /^adrien@exemple\.com:scrypt\$/);
  assert.ok(r.json.token);
  assert.equal((await call({ action: "login", email: "adrien@exemple.com", password: "mon mot de passe" })).status, 401, "l'ancien ne passe plus (mémoire d'instance prime sur la variable)");
  assert.equal((await call({ action: "login", email: "adrien@exemple.com", password: "nouveau mot de passe" })).status, 200);
});

test("comptes : liste, ajout depuis la clé admin, suppression, garde-fou sur son propre compte", async function () {
  let r = await call({ action: "admins", adminKey: "admin-test" });
  assert.deepEqual(r.json.admins, [{ email: "adrien@exemple.com", source: "console" }]);
  r = await call({ action: "admin_set", adminKey: "admin-test", email: "assistant@exemple.com", password: "assistant2026" });
  assert.equal(r.status, 200);
  r = await call({ action: "admin_set", adminKey: "admin-test", email: "pas-un-email", password: "assistant2026" });
  assert.equal(r.status, 400);
  assert.equal((await call({ action: "login", email: "assistant@exemple.com", password: "assistant2026" })).status, 200);
  r = await call({ action: "admins", adminKey: "admin-test" });
  assert.equal(r.json.admins.length, 2);
  r = await call({ action: "admin_delete", adminToken: token, email: "adrien@exemple.com" });
  assert.equal(r.status, 400); assert.match(r.json.error, /propre compte/);
  r = await call({ action: "admin_delete", adminToken: token, email: "assistant@exemple.com" });
  assert.equal(r.status, 200); assert.equal(r.json.stillInEnv, false);
  assert.equal((await call({ action: "login", email: "assistant@exemple.com", password: "assistant2026" })).status, 401);
  // création d'un premier compte par la clé admin, sans session : e-mail requis dans le corps
  r = await call({ action: "password", adminKey: "admin-test", email: "nouveau@exemple.com", password: "premier compte" });
  assert.equal(r.status, 200); assert.equal(r.json.email, "nouveau@exemple.com");
  assert.equal((await call({ action: "login", email: "nouveau@exemple.com", password: "premier compte" })).status, 200);
});
