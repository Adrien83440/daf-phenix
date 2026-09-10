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
  assert.equal(lastRequest.output_config.effort, "low", "la lecture réfléchit peu");
  assert.equal(lastRequest.max_tokens, 24000);
  const txt = lastRequest.messages[0].content.map(function (b) { return b.text || ""; }).join("");
  assert.match(txt, /Prénom : Sam/);
  assert.match(txt, /En couple avec enfant/);
  assert.match(txt, /PRLV NETFLIX/);
  assert.deepEqual(r.json.quota, { used: 1, limit: 2 });
});

test("la situation décrite par la personne et ses versions précédentes sont transmises", function () {
  const t = P.ctxText({ prenom: "Sam", situation_texte: "Je viens de changer de boulot, 2 100 € net, seul en location.", situation_date: "2026-09-10T08:00:00Z", historique_situation: [{ date: "2026-08-02T08:00:00Z", texte: "En recherche d'emploi, chômage 1 300 €." }], precisions: "Le virement du 12 est un remboursement." });
  assert.match(t, /Sa situation, décrite avec ses mots \(mise à jour le 2026-09-10\) : « Je viens de changer de boulot/);
  assert.match(t, /Ce qu'elle disait avant/);
  assert.match(t, /- le 2026-08-02 : « En recherche d'emploi/);
  assert.match(t, /Précisions de la personne : Le virement/);
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

test("lecture trop longue : relance automatique en version compacte", async function () {
  const code = P.mintCode("Compact", 1).code;
  let n = 0;
  nextReply = function (req) {
    n++;
    if (n === 1) return { stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] };
    assert.match(req.messages[0].content[0].text, /Version compacte obligatoire/);
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(vide(P.ETAT_SCHEMA)) }], usage: {} };
  };
  const r = await call({ action: "lecture", code: code, runId: "C1", text: "x".repeat(50) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(n, 2, "deux appels : le second en compact");
  n = 0; nextReply = function () { n++; return { stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }; };
  const r2 = await call({ action: "lecture", code: code, runId: "C1", text: "x".repeat(50) });
  assert.equal(r2.status, 500); assert.match(r2.json.error, /période plus courte/); assert.equal(n, 2);
  // les analyses gardent l'effort standard
  replyWith(vide(P.schemaRapport("audit")));
  await call({ action: "analyse", code: code, runId: "C1", module: "audit", etat: {}, text: "" });
  assert.equal(lastRequest.output_config.effort, "medium");
});

test("bilan du mois : bilan précédent transmis, schéma dédié, refus sans précédent", async function () {
  const code = P.mintCode("Suivi", 1).code;
  let r = await call({ action: "analyse", code: code, runId: "S1", module: "suivi", etat: {}, context: {}, text: "" });
  assert.equal(r.status, 500); assert.match(r.json.error, /premier bilan/);
  replyWith(Object.assign(vide(P.schemaRapport("suivi")), { progres: [{ indicateur: "Reste chaque mois", avant: "170 €", apres: "260 €", tendance: "mieux", commentaire: "La salle résiliée se voit." }], defi_du_mois: { titre: "Zéro découvert", detail: "Solde positif le 27", gain_estime: "18 € d'agios" } }));
  const precedent = { date: "2026-08-10T10:00:00Z", etat: { revenus_mensuels: 2180 }, score: 52, actions: [{ semaine: "S1", action: "Résilier Basic Fit", fait: true, fait_le: "2026-08-14" }, { semaine: "S2", action: "Virement automatique 100 €", fait: false }], libere: "PRLV BASIC FIT (29,99 €/mois)" };
  r = await call({ action: "analyse", code: code, runId: "S1", module: "suivi", etat: { revenus_mensuels: 2180 }, context: {}, text: "", precedent: precedent });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sch = lastRequest.output_config.format.schema;
  assert.ok(sch.properties.progres && sch.properties.defi_du_mois && sch.properties.score && !sch.properties.fuites, "schéma du suivi");
  const txt = lastRequest.messages[0].content[0].text;
  assert.match(txt, /Bilan précédent du 2026-08-10 \(score Phénix 52\/100\)/);
  assert.match(txt, /\[FAIT\] S1 Résilier Basic Fit \(coché le 2026-08-14\)/);
  assert.match(txt, /\[pas fait\] S2 Virement/);
  assert.match(txt, /Abonnements résiliés depuis/);
  assert.match(lastRequest.messages[0].content[1].text, /BILAN DU MOIS/);
  assert.equal(r.json.result.progres[0].tendance, "mieux");
  assert.equal(r.json.result.defi_du_mois.titre, "Zéro découvert");
  assert.deepEqual(r.json.result.fuites, []);
});

test("Phénix en direct : réservé au premium, conversation multi-tours, situation mise à jour", async function () {
  const store = require("../lib/store.js");
  const code = P.mintCode("Vocal", 1).code;
  await store.saveClient({ code: code, product: "perso", tag: "VOCAL", name: "Sam", premium: false });
  let r = await call({ action: "vocal", code: code, turnId: "T1", message: "Je viens de changer de travail." });
  assert.equal(r.status, 403); assert.match(r.json.error, /Premium/);
  await store.saveClient({ code: code, product: "perso", tag: "VOCAL", name: "Sam", premium: true });
  r = await call({ action: "verify", code: code });
  assert.equal(r.json.premium, true, "verify annonce le premium");
  replyWith({ reponse: "Bravo pour le nouveau poste. On met ta situation à jour ?", situation_maj: "Je viens de changer de travail, 2 400 € net.", changement: "Nouveau travail à 2 400 € net.", objectif: "Constituer une épargne de sécurité", action_proposee: { action: "Programmer un virement de 100 €", impact: "Sécurité en 12 mois" } });
  r = await call({ action: "vocal", code: code, turnId: "T1", message: "Je viens de changer de travail, je gagne 2 400 maintenant.", tours: [{ role: "user", texte: "Salut" }, { role: "assistant", texte: "Salut Sam, je t'écoute." }], context: { prenom: "Sam", situation_texte: "Au chômage, 1 300 €." }, etat: { revenus_mensuels: 1300 }, plan: [{ action: "Résilier la salle", fait: true }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.result.situation_maj, "Je viens de changer de travail, 2 400 € net.");
  assert.equal(lastRequest.model, "claude-haiku-4-5-20251001", "la conversation tourne sur un modèle rapide");
  assert.equal(lastRequest.output_config.effort, undefined, "pas de réglage d'effort sur Haiku"); assert.equal(lastRequest.max_tokens, 1200);
  assert.deepEqual(lastRequest.output_config.format.schema, P.VOCAL_SCHEMA);
  const msgs = lastRequest.messages;
  assert.equal(msgs.length, 5, "fond + accusé + 2 tours + message");
  assert.match(msgs[0].content[0].text, /Au chômage, 1 300/); assert.match(msgs[0].content[0].text, /\[fait\] Résilier la salle/);
  assert.match(msgs[0].content[1].text, /conversation orale/); assert.match(msgs[0].content[1].text, /tu t'appelles Nova/);
  assert.equal(msgs[2].role, "user"); assert.equal(msgs[3].role, "assistant"); assert.equal(msgs[4].content, "Je viens de changer de travail, je gagne 2 400 maintenant.");
  assert.deepEqual(r.json.quota, { used: 1, limit: 40 });
  r = await call({ action: "vocal", code: code, turnId: "T1", message: "x" });
  assert.deepEqual(r.json.quota, { used: 1, limit: 40 }, "même tour : pas de consommation");
  r = await call({ action: "vocal", code: code, turnId: "T2", message: "   " });
  assert.equal(r.status, 500); assert.match(r.json.error, /rien entendu/);
  // le quota des bilans n'est pas touché par la conversation
  assert.deepEqual((await call({ action: "verify", code: code })).json.quota, { used: 0, limit: 2 });
});

test("voix naturelle : fournisseur selon la clé, audio renvoyé, repli annoncé", async function () {
  const voix = require("../lib/voix.js");
  const store = require("../lib/store.js");
  assert.equal(voix.provider(), "", "sans clé : voix du navigateur");
  assert.equal((await call({ action: "ping" })).json.voix, "");
  const code = P.mintCode("Voix", 1).code;
  await store.saveClient({ code: code, product: "perso", tag: "VOIX", premium: true });
  let r = await call({ action: "voix", code: code, text: "Bonjour" });
  assert.equal(r.status, 500); assert.match(r.json.error, /Aucune voix configurée/);

  process.env.OPENAI_API_KEY = "sk-test"; process.env.OPENAI_TTS_VOICE = "coral";
  assert.equal(voix.provider(), "openai");
  assert.equal((await call({ action: "verify", code: code })).json.voix, true);
  const saved = global.fetch;
  let audioReq = null;
  global.fetch = async function (url, opts) {
    if (/openai\.com\/v1\/audio\/speech/.test(url)) { audioReq = { url: url, body: JSON.parse(opts.body), auth: opts.headers.authorization }; return { ok: true, arrayBuffer: async () => new Uint8Array([73, 68, 51, 4, 0]).buffer }; }
    return saved(url, opts);
  };
  const res = await new Promise(function (resolve) {
    const out = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); } };
    perso({ method: "POST", body: { action: "voix", code: code, text: "Bravo pour le nouveau poste." }, headers: { "x-forwarded-for": "10.0.9.9" }, socket: {} }, out);
  });
  assert.equal(res.status, 200); assert.equal(res.headers["Content-Type"], "audio/mpeg"); assert.equal(res.body.length, 5);
  assert.equal(audioReq.body.voice, "coral"); assert.equal(audioReq.body.model, "gpt-4o-mini-tts"); assert.equal(audioReq.auth, "Bearer sk-test");
  assert.match(audioReq.body.instructions, /français/);

  process.env.ELEVENLABS_API_KEY = "el-test"; process.env.ELEVENLABS_VOICE_ID = "VOIX123";
  assert.equal(voix.provider(), "elevenlabs", "ElevenLabs prime quand les deux clés existent");
  global.fetch = async function (url, opts) {
    if (/elevenlabs\.io\/v1\/text-to-speech\/VOIX123/.test(url)) { audioReq = { body: JSON.parse(opts.body), key: opts.headers["xi-api-key"] }; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; }
    if (/elevenlabs/.test(url)) return { ok: false, status: 401, text: async () => "bad key" };
    return saved(url, opts);
  };
  const el = await voix.synthese("Salut Sam.");
  assert.equal(el.audio.length, 3); assert.equal(audioReq.key, "el-test"); assert.equal(audioReq.body.model_id, "eleven_flash_v2_5"); assert.equal(audioReq.body.language_code, "fr");
  // sans premium : refus
  await store.saveClient({ code: code, product: "perso", tag: "VOIX", premium: false });
  r = await call({ action: "voix", code: code, text: "x" });
  assert.equal(r.status, 403);
  delete process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_VOICE_ID; delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_TTS_VOICE;
  global.fetch = saved;
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
