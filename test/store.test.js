// lib/store.js sur le moteur KV : l'API REST Upstash est simulée par un mini Redis en mémoire.
"use strict";
// Variables préfixées comme le fait le marketplace Vercel (dafphenix_KV_REST_API_URL)
process.env.dafphenix_KV_REST_API_URL = "https://kv.test.local";
process.env.dafphenix_KV_REST_API_TOKEN = "jeton";

const test = require("node:test");
const assert = require("node:assert/strict");

// --- mini Redis -------------------------------------------------------------
const db = new Map();
let failNext = false;
function exec(cmd) {
  const [op, key] = cmd;
  const H = () => db.get(key) || (db.set(key, new Map()), db.get(key));
  const S = () => db.get(key) || (db.set(key, new Set()), db.get(key));
  const L = () => db.get(key) || (db.set(key, []), db.get(key));
  switch (op) {
    case "PING": return "PONG";
    case "HSET": { const h = H(); let n = 0; for (let i = 2; i < cmd.length; i += 2) { if (!h.has(cmd[i])) n++; h.set(cmd[i], String(cmd[i + 1])); } return n; }
    case "HGET": return db.has(key) && db.get(key).has(cmd[2]) ? db.get(key).get(cmd[2]) : null;
    case "HGETALL": { const out = []; (db.get(key) || new Map()).forEach((v, k) => out.push(k, v)); return out; }
    case "HDEL": return db.has(key) ? (db.get(key).delete(cmd[2]) ? 1 : 0) : 0;
    case "HINCRBY": { const h = H(); const v = parseInt(h.get(cmd[2]) || "0", 10) + parseInt(cmd[3], 10); h.set(cmd[2], String(v)); return v; }
    case "DEL": return db.delete(key) ? 1 : 0;
    case "SADD": { const s = S(); const had = s.has(String(cmd[2])); s.add(String(cmd[2])); return had ? 0 : 1; }
    case "SREM": return db.has(key) ? (db.get(key).delete(String(cmd[2])) ? 1 : 0) : 0;
    case "SISMEMBER": return db.has(key) && db.get(key).has(String(cmd[2])) ? 1 : 0;
    case "SMEMBERS": return Array.from(db.get(key) || []);
    case "SCARD": return db.has(key) ? db.get(key).size : 0;
    case "EXPIRE": return db.has(key) ? 1 : 0;
    case "LPUSH": { const l = L(); l.unshift(String(cmd[2])); return l.length; }
    case "LTRIM": { const l = L(); l.splice(parseInt(cmd[3], 10) + 1); return "OK"; }
    case "LRANGE": { const l = db.get(key) || []; const stop = parseInt(cmd[3], 10); return l.slice(parseInt(cmd[2], 10), stop < 0 ? undefined : stop + 1); }
    default: throw new Error("commande non simulée : " + op);
  }
}
let calls = 0;
global.fetch = async function (url, opts) {
  calls++;
  if (failNext) { failNext = false; throw new Error("KV injoignable"); }
  assert.equal(opts.headers.authorization, "Bearer jeton");
  const body = JSON.parse(opts.body);
  if (/\/pipeline$/.test(url)) return { json: async () => body.map(c => ({ result: exec(c) })) };
  return { json: async () => ({ result: exec(body) }) };
};

const store = require("../lib/store.js");

test("moteur KV détecté, ping", async function () {
  assert.equal(store.backend(), "kv");
  assert.deepEqual(await store.ping(), { backend: "kv", ok: true });
});

test("clients : enregistrement, lecture, liste, suppression", async function () {
  await store.saveClient({ code: "phx-a-2612-xxxxxxxx", product: "pro", tag: "A", name: "Alice" });
  await store.saveClient({ code: "PXP-B-2612-YYYYYYYY", product: "perso", tag: "B", name: "Bob" });
  const a = await store.getClient("phx-a-2612-xxxxxxxx");
  assert.equal(a.code, "PHX-A-2612-XXXXXXXX", "le code est normalisé en majuscules");
  assert.equal(a.name, "Alice");
  assert.equal((await store.listClients()).length, 2);
  await store.deleteClient("PHX-A-2612-XXXXXXXX");
  assert.equal((await store.listClients()).length, 1);
  assert.equal(await store.getClient("PHX-A-2612-XXXXXXXX"), null);
});

test("révocation", async function () {
  await store.setRevoked("PXP-B-2612-YYYYYYYY", true);
  assert.equal(await store.isRevoked("pxp-b-2612-yyyyyyyy"), true);
  assert.deepEqual(await store.revokedList(), ["PXP-B-2612-YYYYYYYY"]);
  await store.setRevoked("PXP-B-2612-YYYYYYYY", false);
  assert.equal(await store.isRevoked("PXP-B-2612-YYYYYYYY"), false);
});

test("quota par session, partagé entre instances via KV", async function () {
  let r = await store.consumeRun("perso", "C1", "S1", 2);
  assert.deepEqual(r, { ok: true, used: 1, limit: 2 });
  r = await store.consumeRun("perso", "C1", "S1", 2);
  assert.deepEqual(r, { ok: true, used: 1, limit: 2 }, "même session : pas de consommation");
  r = await store.consumeRun("perso", "C1", "S2", 2);
  assert.equal(r.used, 2);
  r = await store.consumeRun("perso", "C1", "S3", 2);
  assert.deepEqual(r, { ok: false, used: 2, limit: 2 }, "au-delà de la limite : refus, et la session refusée n'est pas comptée");
  assert.equal(await store.quotaUsed("C1"), 2);
  const day = (await store.dayStats(1))[0];
  assert.equal(day.perso.runs, 2);
  assert.equal(day.pro.runs, 0);
});

test("activité : événements, compteurs du jour et du client, jetons", async function () {
  await store.record({ product: "pro", code: "c1", label: "C1", action: "lecture", ok: true, ms: 1200, usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } });
  await store.record({ product: "pro", code: "c1", label: "C1", action: "analyse", module: "audit", ok: false, ms: 300, error: "IA : erreur 500" });
  const ev = await store.events(10);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].module, "audit"); assert.equal(ev[0].ok, false); assert.match(ev[0].error, /erreur 500/);
  assert.equal(ev[1].in, 1000); assert.equal(ev[1].cache_write, 100);
  const day = (await store.dayStats(2))[1];
  assert.equal(day.pro.calls, 2); assert.equal(day.pro.errors, 1); assert.equal(day.pro.in, 1000); assert.equal(day.pro.out, 500);
  const cs = (await store.clientStats(["C1"])).C1;
  assert.equal(cs.calls, 2); assert.equal(cs.errors, 1); assert.equal(cs.cache_read, 200); assert.equal(cs.last_action, "analyse:audit");
  assert.ok(cs.last_seen);
});

test("traced journalise succès et échec sans changer le résultat", async function () {
  const out = await store.traced({ product: "perso", code: "T", action: "lecture" }, async () => ({ data: { x: 1 }, usage: { input_tokens: 10, output_tokens: 5 } }));
  assert.deepEqual(out.data, { x: 1 });
  await assert.rejects(store.traced({ product: "perso", code: "T", action: "analyse", module: "plan" }, async () => { throw new Error("boum"); }), /boum/);
  const ev = await store.events(2);
  assert.equal(ev[0].ok, false); assert.equal(ev[0].error, "boum"); assert.equal(ev[1].ok, true); assert.equal(ev[1].out, 5);
});

test("panne KV : le client n'est pas bloqué (repli mémoire)", async function () {
  failNext = true;
  const r = await store.consumeRun("pro", "PANNE", "S1", 3);
  assert.equal(r.ok, true);
  failNext = true;
  assert.equal(await store.isRevoked("PANNE"), false);
  failNext = true;
  await store.record({ product: "pro", code: "PANNE", action: "lecture", ok: true });
  failNext = true;
  assert.equal(await store.getClient("PANNE"), null);
});

test("dayStats renvoie n jours consécutifs jusqu'à aujourd'hui", async function () {
  const d = await store.dayStats(7);
  assert.equal(d.length, 7);
  assert.equal(d[6].date, store.today());
  assert.ok(calls > 10, "les appels passent bien par l'API REST simulée");
});
