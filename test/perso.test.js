// Tests de la fonction Phénix Perso : node --test
// L'API Anthropic est simulée (fetch remplacé), aucun appel réseau.
"use strict";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.DAF_ACCESS_SECRET = "secret-de-test";
process.env.DAF_ADMIN_KEY = "admin-test";
process.env.PERSO_DAILY_QUOTA = "2";
process.env.PERSO_ACCESS_CODES = "ESSAI:Offre essai:2099-12-31,VIEUX:Expiré:2020-01-01";
process.env.PERSO_REVOKED = "BANNI";

const test = require("node:test");
const assert = require("node:assert/strict");
const daf = require("../api/daf.js");
const perso = require("../api/perso.js");
const P = perso._internal;

// --- API Anthropic simulée --------------------------------------------------
let lastRequest = null;
let nextReply = null;
global.fetch = async function (url, opts) {
  lastRequest = JSON.parse(opts.body);
  const reply = typeof nextReply === "function" ? nextReply(lastRequest) : nextReply;
  return { ok: true, json: async function () { return reply; } };
};
function replyWith(obj) {
  nextReply = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 10, output_tokens: 20 } };
}
function call(body, headers) {
  return new Promise(function (resolve) {
    const res = { headers: {}, statusCode: 200, setHeader: function (k, v) { this.headers[k] = v; }, status: function (s) { this.statusCode = s; return this; }, end: function (t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    perso({ method: "POST", body: body, headers: Object.assign({ "x-forwarded-for": "10.0.0." + Math.floor(Math.random() * 250) }, headers || {}), socket: {} }, res);
  });
}
function vide(schema) {
  if (schema.type === "array") return [];
  if (schema.type === "object") { const o = {}; Object.keys(schema.properties).forEach(function (k) { o[k] = vide(schema.properties[k]); }); return o; }
  if (schema.enum) return schema.enum[0];
  if (schema.type === "number" || schema.type === "integer") return 0;
  return "x";
}

// --- Codes -----------------------------------------------------------------
test("mint produit un code PXP valide, refusé sur l'API Pro", function () {
  const m = P.mintCode("Marie Dupont", 1);
  assert.match(m.code, /^PXP-MARIEDUPON-\d{4}-[A-Z0-9]{8}$/);
  assert.equal(m.product, "perso");
  const ok = P.checkCode(m.code);
  assert.equal(ok.ok, true);
  assert.equal(ok.label, "MARIEDUPON");
  assert.equal(ok.expires, m.expires);
  assert.equal(daf._internal.checkCode(m.code).ok, false, "un code Perso ne doit pas ouvrir l'outil Pro");
});

test("un caractère modifié invalide le code", function () {
  const m = P.mintCode("Karim", 3);
  const faux = m.code.slice(0, -1) + (m.code.slice(-1) === "A" ? "B" : "A");
  assert.equal(P.checkCode(faux).ok, false);
  assert.equal(P.checkCode(m.code.toLowerCase()).ok, true, "la casse ne compte pas");
});

test("un code Pro valide ouvre aussi l'espace perso", function () {
  const pro = daf._internal.mintCode("Le Comptoir", 12);
  const r = P.checkCode(pro.code);
  assert.equal(r.ok, true);
  assert.equal(r.product, "pro");
});

test("codes fixes, expiration et révocation", function () {
  assert.equal(P.checkCode("essai").ok, true);
  assert.equal(P.checkCode("VIEUX").ok, false);
  assert.match(P.checkCode("VIEUX").error, /expiré/);
  const b = P.mintCode("Banni", 1);
  assert.equal(P.checkCode(b.code).ok, false);
  assert.match(P.checkCode(b.code).error, /désactivé/);
  assert.equal(P.checkCode("").ok, false);
  assert.equal(P.checkCode("PXP-AB-9913-AAAAAAAA").ok, false);
});

// --- Schémas ---------------------------------------------------------------
test("chaque module a un schéma réduit et le rapport est complété", function () {
  Object.keys(P.MODULE_PROMPTS).forEach(function (mod) {
    const s = P.schemaRapport(mod);
    assert.ok(Object.keys(s.properties).length < Object.keys(P.RAPPORT_SCHEMA.properties).length, mod);
    assert.ok(s.properties.plan_90_jours && s.properties.mot_du_daf, mod);
    const full = P.rapportComplet(vide(s));
    assert.deepEqual(Object.keys(full), Object.keys(P.RAPPORT_SCHEMA.properties));
  });
  assert.ok(P.schemaRapport("audit").properties.score);
  assert.ok(!P.schemaRapport("fuites").properties.score);
  assert.deepEqual(P.rapportComplet({}).score, { global: 0, budget: 0, epargne: 0, depenses: 0, dettes: 0, securite: 0 });
});

test("le cadre légal est dans le persona", function () {
  assert.match(P.SYSTEM, /ne recommandes JAMAIS un placement/);
  assert.match(P.SYSTEM, /Point Conseil Budget/);
  assert.match(P.SYSTEM, /Banque de France/);
  assert.match(P.MODULE_PROMPTS.plan, /aucun placement/);
  assert.match(P.MODULE_PROMPTS.dettes, /rachat ou un regroupement/);
  assert.match(P.LECTURE_PROMPT, /IBAN/);
});

// --- Handler ---------------------------------------------------------------
test("ping, mint et verify via le handler", async function () {
  let r = await call({ action: "ping" });
  assert.equal(r.status, 200);
  assert.equal(r.json.product, "perso");
  assert.equal(r.json.configured, true);
  assert.equal(r.json.quota, 2);

  r = await call({ action: "mint", adminKey: "faux", name: "Léa", months: 1 });
  assert.equal(r.status, 401);
  r = await call({ action: "mint", adminKey: "admin-test", name: "Léa", months: 1 });
  assert.equal(r.status, 200);
  assert.match(r.json.code, /^PXP-LEA-/);

  const v = await call({ action: "verify", code: r.json.code });
  assert.equal(v.status, 200);
  assert.equal(v.json.label, "LEA");
  assert.deepEqual(v.json.quota, { used: 0, limit: 2 });
  const bad = await call({ action: "verify", code: "PXP-NOPE-2612-ZZZZZZZZ" });
  assert.equal(bad.status, 401);
});

test("lecture : persona perso, schéma état, contexte transmis", async function () {
  const code = P.mintCode("Lecture", 1).code;
  replyWith(vide(P.ETAT_SCHEMA));
  const r = await call({ action: "lecture", code: code, runId: "RUN1", text: "01/06 CARTE CARREFOUR -82,40\n02/06 VIR SALAIRE +2100,00\n05/06 PRLV NETFLIX -13,49", context: { prenom: "Sam", situation: "couple_enfants", objectif: "Constituer une épargne de sécurité" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.action, "lecture");
  assert.equal(lastRequest.system[0].text, P.SYSTEM, "la lecture perso doit utiliser le persona perso, pas celui du DAF Pro");
  assert.deepEqual(lastRequest.output_config.format.schema, P.ETAT_SCHEMA);
  const txt = lastRequest.messages[0].content.map(function (b) { return b.text || ""; }).join("");
  assert.match(txt, /Prénom : Sam/);
  assert.match(txt, /En couple avec enfant/);
  assert.match(txt, /PRLV NETFLIX/);
  assert.deepEqual(r.json.quota, { used: 1, limit: 2 });
});

test("analyse : schéma du module, rapport complété, quota par runId", async function () {
  const code = P.mintCode("Analyse", 1).code;
  replyWith(Object.assign(vide(P.schemaRapport("dettes")), { titre: "Dettes", dettes: [{ nom: "Crédit conso", capital_restant: 4000, taux: 6.5, mensualite: 180, priorite: 1, action: "Rembourser en premier" }] }));
  const etat = vide(P.ETAT_SCHEMA);
  let r = await call({ action: "analyse", code: code, runId: "R-A", module: "dettes", etat: etat, context: {}, text: "" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.module, "dettes");
  assert.deepEqual(lastRequest.output_config.format.schema, P.schemaRapport("dettes"));
  assert.equal(r.json.result.dettes[0].nom, "Crédit conso");
  assert.deepEqual(r.json.result.allocation, [], "les sections hors module sont complétées vides");
  assert.equal(r.json.result.score.global, 0);
  assert.deepEqual(r.json.quota, { used: 1, limit: 2 });

  // même runId : pas de consommation supplémentaire
  replyWith(vide(P.schemaRapport("audit")));
  r = await call({ action: "analyse", code: code, runId: "R-A", module: "audit", etat: etat, context: {}, text: "" });
  assert.deepEqual(r.json.quota, { used: 1, limit: 2 });
  // second run
  r = await call({ action: "analyse", code: code, runId: "R-B", module: "audit", etat: etat, context: {}, text: "" });
  assert.deepEqual(r.json.quota, { used: 2, limit: 2 });
  // troisième run : refusé
  r = await call({ action: "analyse", code: code, runId: "R-C", module: "audit", etat: etat, context: {}, text: "" });
  assert.equal(r.status, 429);
  assert.match(r.json.error, /bilans du jour/);

  r = await call({ action: "analyse", code: code, runId: "R-A", module: "inconnu", etat: etat });
  assert.equal(r.status, 500);
  assert.match(r.json.error, /Module inconnu/);
});

test("refus et réponse illisible de l'IA remontent en erreur lisible", async function () {
  const code = P.mintCode("Erreurs", 1).code;
  nextReply = { stop_reason: "refusal", content: [] };
  let r = await call({ action: "lecture", code: code, runId: "E1", text: "x".repeat(40) });
  assert.equal(r.status, 500);
  assert.match(r.json.error, /n'a pas pu traiter/);
  nextReply = { stop_reason: "end_turn", content: [{ type: "text", text: "{pas du json" }] };
  r = await call({ action: "lecture", code: code, runId: "E1", text: "x".repeat(40) });
  assert.match(r.json.error, /illisible/);
});

test("la fonction Pro reste inchangée : persona Pro par défaut", async function () {
  replyWith(vide(daf._internal.ETAT_SCHEMA));
  await daf._internal.callClaude([{ type: "text", text: "test" }], daf._internal.ETAT_SCHEMA, 100);
  assert.match(lastRequest.system[0].text, /^Tu es DAF Phénix/);
});
