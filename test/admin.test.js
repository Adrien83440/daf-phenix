// Console d'administration : api/admin.js sur le moteur mémoire, avec les fonctions Pro et Perso (IA simulée).
"use strict";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.DAF_ACCESS_SECRET = "secret-de-test";
process.env.DAF_ADMIN_KEY = "admin-test";
process.env.DAF_DAILY_QUOTA = "3";
process.env.PERSO_DAILY_QUOTA = "2";
process.env.DAF_REVOKED = "ENVBANNI";
process.env.DAF_BRIDGE_KEY = "pont";
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("../api/admin.js");
const daf = require("../api/daf.js");
const perso = require("../api/perso.js");
const store = require("../lib/store.js");

global.fetch = async function (url, opts) {
  const body = JSON.parse(opts.body);
  const schema = body.output_config.format.schema;
  const vide = s => { if (s.type === "array") return []; if (s.type === "object") { const o = {}; Object.keys(s.properties).forEach(k => { o[k] = vide(s.properties[k]); }); return o; } if (s.enum) return s.enum[0]; if (s.type === "number" || s.type === "integer") return 0; return "x"; };
  return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(vide(schema)) }], usage: { input_tokens: 2000, output_tokens: 800, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 } }) };
};
function call(fn, body, headers) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    fn({ method: "POST", body, headers: Object.assign({ "x-forwarded-for": "10.1." + Math.floor(Math.random() * 200) + "." + Math.floor(Math.random() * 200) }, headers || {}), socket: {} }, res);
  });
}
const A = (body) => call(admin, Object.assign({ adminKey: "admin-test" }, body));

test("authentification", async function () {
  assert.equal((await call(admin, { action: "overview" })).status, 401);
  assert.equal((await call(admin, { action: "overview", adminKey: "faux" })).status, 401);
  assert.equal((await call(admin, { action: "overview" }, { "x-admin-key": "admin-test" })).status, 200, "clé acceptée en en-tête");
});

test("overview : configuration et totaux à zéro", async function () {
  const r = await A({ action: "overview" });
  assert.equal(r.status, 200);
  const j = r.json;
  assert.equal(j.config.store.backend, "memory");
  assert.deepEqual(j.config.configured, { api: true, secret: true, admin: true, bridge: true });
  assert.equal(j.config.quotaPro, 3); assert.equal(j.config.quotaPerso, 2);
  assert.deepEqual(j.config.revokedEnv.pro, ["ENVBANNI"]);
  assert.equal(j.days.length, 30);
  assert.equal(j.totals.d30.runs, 0);
});

let codePro, codePerso;
test("mint : un client Pro et un abonné Perso enregistrés", async function () {
  let r = await A({ action: "mint", product: "pro", name: "Le Comptoir", months: 12, email: "pat@comptoir.fr", note: "Offre lancement" });
  assert.equal(r.status, 200); codePro = r.json.code;
  assert.match(codePro, /^PHX-LECOMPTOIR-/);
  assert.equal(r.json.client.email, "pat@comptoir.fr");
  r = await A({ action: "mint", product: "perso", name: "Marie", months: 1, quota: 8 });
  codePerso = r.json.code;
  assert.match(codePerso, /^PXP-MARIE-/);
  assert.equal(r.json.client.quota, 8);
  const list = (await A({ action: "clients" })).json.clients;
  assert.equal(list.length, 2);
  const m = list.find(c => c.code === codePerso);
  assert.equal(m.status, "actif"); assert.equal(m.limit, 8, "quota personnalisé"); assert.equal(m.usedToday, 0);
  const lc = list.find(c => c.code === codePro);
  assert.equal(lc.limit, 3);
});

test("l'usage réel remonte dans la console (quota, appels, coût)", async function () {
  let r = await call(perso, { action: "verify", code: codePerso });
  assert.deepEqual(r.json.quota, { used: 0, limit: 8 }, "la fonction Perso applique le quota personnalisé");
  r = await call(perso, { action: "lecture", code: codePerso, runId: "RUN1", text: "x".repeat(50) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await call(perso, { action: "analyse", code: codePerso, runId: "RUN1", module: "audit", etat: {}, text: "" });
  assert.equal(r.status, 200);
  r = await call(daf, { action: "analyse", code: codePro, runId: "RUNP", module: "fuites", etat: {}, text: "" });
  assert.equal(r.status, 200);
  const list = (await A({ action: "clients" })).json.clients;
  const m = list.find(c => c.code === codePerso);
  assert.equal(m.usedToday, 1, "lecture + analyse d'une même session = 1 bilan");
  assert.equal(m.stats.calls, 2); assert.equal(m.stats.runs, 1); assert.equal(m.stats.in, 4000); assert.equal(m.stats.out, 1600);
  assert.ok(m.cost > 0.02 && m.cost < 0.03, "coût estimé " + m.cost);
  assert.equal(m.stats.last_action, "analyse:audit");
  const ov = (await A({ action: "overview" })).json;
  assert.equal(ov.totals.today.runs, 2); assert.equal(ov.totals.today.calls, 3);
  assert.equal(ov.totals.today.pro_runs, 1); assert.equal(ov.totals.today.perso_runs, 1);
  assert.equal(ov.events.length, 3);
  assert.equal(ov.events[0].module, "fuites");
  assert.equal(ov.totals.clients.pro.actif, 1);
});

test("révocation depuis la console : l'accès est refusé immédiatement, puis rétabli", async function () {
  await A({ action: "revoke", code: codePerso });
  let r = await call(perso, { action: "verify", code: codePerso });
  assert.equal(r.status, 401); assert.match(r.json.error, /désactivé/);
  let list = (await A({ action: "clients" })).json.clients;
  assert.equal(list.find(c => c.code === codePerso).status, "revoque");
  await A({ action: "unrevoke", code: codePerso });
  r = await call(perso, { action: "verify", code: codePerso });
  assert.equal(r.status, 200);
});

test("prolongation : nouveau code, ancien remplacé et révoqué, fiche conservée", async function () {
  const r = await A({ action: "extend", code: codePro, months: 6 });
  assert.equal(r.status, 200);
  const next = r.json.code;
  assert.notEqual(next, codePro);
  assert.match(next, /^PHX-LECOMPTOIR-/);
  assert.equal(r.json.client.email, "pat@comptoir.fr");
  assert.equal(r.json.client.replaces, codePro);
  const list = (await A({ action: "clients" })).json.clients;
  assert.equal(list.find(c => c.code === codePro).status, "remplace");
  assert.equal(list.find(c => c.code === next).status, "actif");
  assert.equal((await call(daf, { action: "verify", code: codePro })).status, 401);
  assert.equal((await call(daf, { action: "verify", code: next })).status, 200);
  codePro = next;
});

test("update, import d'un code existant, verify, delete", async function () {
  let r = await A({ action: "update", code: codePro, note: "VIP", quota: 20 });
  assert.equal(r.json.client.note, "VIP"); assert.equal(r.json.client.quota, 20);
  assert.deepEqual((await call(daf, { action: "verify", code: codePro })).json.quota, { used: 0, limit: 20 });

  const old = daf._internal.mintCode("Ancien Client", 3).code;
  r = await A({ action: "import", code: old, name: "Ancien client", email: "a@b.fr" });
  assert.equal(r.status, 200); assert.equal(r.json.client.product, "pro"); assert.equal(r.json.client.tag, "ANCIENCLIE"); assert.equal(r.json.client.source, "import");
  r = await A({ action: "import", code: "PHX-FAUX-2612-AAAAAAAA" });
  assert.equal(r.status, 400);

  r = await A({ action: "verify", code: codePerso });
  assert.equal(r.json.valid, true); assert.equal(r.json.product, "perso"); assert.equal(r.json.client.name, "Marie");

  r = await A({ action: "delete", code: codePerso });
  assert.equal(r.status, 200);
  assert.equal((await call(perso, { action: "verify", code: codePerso })).status, 401, "un code supprimé est aussi révoqué");
  const list = (await A({ action: "clients" })).json.clients;
  assert.ok(!list.find(c => c.code === codePerso && !c.unregistered));
});

test("codes vus mais non enregistrés (Academy, codes fixes) apparaissent comme inconnus", async function () {
  const r = await call(daf, { action: "analyse", module: "audit", etat: {}, label: "Léa", bridgeKey: "pont" });
  assert.equal(r.status, 200);
  const list = (await A({ action: "clients" })).json.clients;
  const ac = list.find(c => c.code === "ACADEMY");
  assert.ok(ac && ac.unregistered && ac.status === "academy");
  assert.equal(ac.stats.calls, 1);
});

test("statuts calculés : expire bientôt, expiré, révoqué par variable d'environnement", function () {
  const st = admin._internal.status;
  const today = store.today();
  const soon = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const far = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  assert.equal(st({ code: "X", product: "pro", tag: "A", expires: far }, new Set(), today), "actif");
  assert.equal(st({ code: "X", product: "pro", tag: "A", expires: soon }, new Set(), today), "bientot");
  assert.equal(st({ code: "X", product: "pro", tag: "A", expires: "2020-01-31" }, new Set(), today), "expire");
  assert.equal(st({ code: "X", product: "pro", tag: "ENVBANNI", expires: far }, new Set(), today), "revoque");
  assert.equal(st({ code: "X", product: "pro", tag: "A", expires: far }, new Set(["X"]), today), "revoque");
  assert.equal(st({ code: "X", product: "pro", tag: "A", expires: far, replacedBy: "Y" }, new Set(), today), "remplace");
});
