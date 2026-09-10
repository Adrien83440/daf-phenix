// Comptes utilisateurs (e-mail + mot de passe provisoire) pour les outils Pro et Perso.
"use strict";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.DAF_ACCESS_SECRET = "secret-de-test";
process.env.DAF_ADMIN_KEY = "admin-test";
process.env.DAF_ACCOUNTS_MEMORY_OK = "1";
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("../api/admin.js");
const daf = require("../api/daf.js");
const perso = require("../api/perso.js");
const accounts = require("../lib/accounts.js");

global.fetch = async () => ({ ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: {} }) });
function call(fn, body, ip) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    fn({ method: "POST", body, headers: { "x-forwarded-for": ip || "10.4.0." + Math.floor(Math.random() * 250) }, socket: {} }, res);
  });
}
const A = body => call(admin, Object.assign({ adminKey: "admin-test" }, body));

test("mot de passe provisoire lisible", function () {
  const p = accounts.provisionalPassword();
  assert.match(p, /^[a-z]+-[a-z]+-\d{4}$/);
  assert.notEqual(p, accounts.provisionalPassword());
});

let codePerso, pwPerso;
test("mint avec compte : e-mail requis, mot de passe provisoire renvoyé, hash jamais exposé", async function () {
  let r = await A({ action: "mint", product: "perso", name: "Marie", months: 1, access: "account" });
  assert.equal(r.status, 400); assert.match(r.json.error, /e-mail/);
  assert.equal((await A({ action: "clients" })).json.clients.length, 0, "aucune fiche orpheline");
  r = await A({ action: "mint", product: "perso", name: "Marie", months: 1, access: "account", email: "Marie@Exemple.fr" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  codePerso = r.json.code; pwPerso = r.json.password;
  assert.match(pwPerso, /^[a-z]+-[a-z]+-\d{4}$/);
  assert.equal(r.json.client.email, "marie@exemple.fr");
  assert.equal(r.json.client.account, true); assert.equal(r.json.client.mustChange, true);
  assert.equal(r.json.client.passwordHash, undefined);
  const list = (await A({ action: "clients" })).json.clients;
  assert.equal(list[0].account, true); assert.equal(list[0].passwordHash, undefined);
});

test("connexion Perso : provisoire accepté, mustChange, puis changement obligatoire", async function () {
  let r = await call(perso, { action: "login", email: "marie@exemple.fr", password: "faux" });
  assert.equal(r.status, 401);
  r = await call(perso, { action: "login", email: "MARIE@exemple.fr", password: pwPerso });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.code, codePerso); assert.equal(r.json.mustChange, true); assert.equal(r.json.product, "perso"); assert.equal(r.json.label, "Marie");
  assert.ok(r.json.expires);
  r = await call(perso, { action: "password", email: "marie@exemple.fr", current: "faux", password: "mon nouveau mdp" });
  assert.equal(r.status, 401);
  r = await call(perso, { action: "password", email: "marie@exemple.fr", current: pwPerso, password: pwPerso });
  assert.equal(r.status, 400); assert.match(r.json.error, /différent/);
  r = await call(perso, { action: "password", email: "marie@exemple.fr", current: pwPerso, password: "court" });
  assert.equal(r.status, 400);
  r = await call(perso, { action: "password", email: "marie@exemple.fr", current: pwPerso, password: "mon nouveau mdp" });
  assert.equal(r.status, 200);
  r = await call(perso, { action: "login", email: "marie@exemple.fr", password: pwPerso });
  assert.equal(r.status, 401, "le provisoire ne passe plus");
  r = await call(perso, { action: "login", email: "marie@exemple.fr", password: "mon nouveau mdp" });
  assert.equal(r.status, 200); assert.equal(r.json.mustChange, false);
  // le code obtenu fonctionne comme avant
  r = await call(perso, { action: "verify", code: r.json.code });
  assert.equal(r.status, 200);
});

test("un compte Perso n'ouvre pas l'outil Pro ; un compte Pro ouvre les deux", async function () {
  let r = await call(daf, { action: "login", email: "marie@exemple.fr", password: "mon nouveau mdp" });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /inconnu/i, "le code PXP est refusé par le vérificateur Pro");
  const m = await A({ action: "mint", product: "pro", name: "Le Comptoir", months: 12, access: "account", email: "pat@comptoir.fr", note: "VIP" });
  assert.equal(m.status, 200);
  r = await call(daf, { action: "login", email: "pat@comptoir.fr", password: m.json.password });
  assert.equal(r.status, 200); assert.equal(r.json.product, "pro"); assert.equal(r.json.label, "Le Comptoir");
  r = await call(perso, { action: "login", email: "pat@comptoir.fr", password: m.json.password });
  assert.equal(r.status, 200); assert.equal(r.json.product, "pro");
});

test("révocation et prolongation suivent le compte", async function () {
  await A({ action: "revoke", code: codePerso });
  let r = await call(perso, { action: "login", email: "marie@exemple.fr", password: "mon nouveau mdp" });
  assert.equal(r.status, 401); assert.match(r.json.error, /désactivé/);
  await A({ action: "unrevoke", code: codePerso });
  const ext = await A({ action: "extend", code: codePerso, months: 2 });
  assert.equal(ext.status, 200);
  assert.equal(ext.json.client.account, true);
  r = await call(perso, { action: "login", email: "marie@exemple.fr", password: "mon nouveau mdp" });
  assert.equal(r.status, 200); assert.equal(r.json.code, ext.json.code, "le compte pointe vers le nouveau code");
  codePerso = ext.json.code;
});

test("réinitialisation par la console, changement d'e-mail, adresse déjà prise, suppression", async function () {
  let r = await A({ action: "reset_password", code: codePerso });
  assert.equal(r.status, 200); assert.equal(r.json.client.mustChange, true);
  const pw2 = r.json.password;
  assert.equal((await call(perso, { action: "login", email: "marie@exemple.fr", password: "mon nouveau mdp" })).status, 401);
  assert.equal((await call(perso, { action: "login", email: "marie@exemple.fr", password: pw2 })).json.mustChange, true);

  r = await A({ action: "update", code: codePerso, email: "pas un email" });
  assert.equal(r.status, 400);
  r = await A({ action: "update", code: codePerso, email: "Marie.D@exemple.fr" });
  assert.equal(r.status, 200); assert.equal(r.json.client.email, "marie.d@exemple.fr");
  assert.equal((await call(perso, { action: "login", email: "marie@exemple.fr", password: pw2 })).status, 401, "l'ancienne adresse ne fonctionne plus");
  assert.equal((await call(perso, { action: "login", email: "marie.d@exemple.fr", password: pw2 })).status, 200);

  r = await A({ action: "mint", product: "perso", name: "Doublon", months: 1, access: "account", email: "marie.d@exemple.fr" });
  assert.equal(r.status, 409); assert.match(r.json.error, /déjà rattachée/);

  // fiche sans compte, puis création du compte par reset_password
  const c = await A({ action: "mint", product: "perso", name: "Sans compte", months: 1, email: "sans@exemple.fr" });
  assert.equal(c.json.password, ""); assert.equal(c.json.client.account, false);
  r = await A({ action: "reset_password", code: c.json.code });
  assert.equal(r.status, 200); assert.equal(r.json.client.account, true);
  assert.equal((await call(perso, { action: "login", email: "sans@exemple.fr", password: r.json.password })).status, 200);

  await A({ action: "delete", code: codePerso });
  assert.equal((await call(perso, { action: "login", email: "marie.d@exemple.fr", password: pw2 })).status, 401);
});

test("limitation des tentatives par adresse IP, partagée avec la console", async function () {
  const ip = "10.5.5.5";
  for (let i = 0; i < 8; i++) await call(perso, { action: "login", email: "sans@exemple.fr", password: "faux" }, ip);
  const r = await call(perso, { action: "login", email: "sans@exemple.fr", password: "faux" }, ip);
  assert.equal(r.status, 429);
});

test("ping annonce si les comptes sont possibles", async function () {
  assert.equal((await call(perso, { action: "ping" })).json.accounts, true);
  assert.equal((await A({ action: "overview" })).json.config.accounts, true);
});
