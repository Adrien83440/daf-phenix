// Tests d'interface de perso.html dans jsdom (sans navigateur, sans réseau, sans IA).
//
//   npm install --no-save jsdom      (une fois ; jsdom n'est pas une dépendance du projet)
//   npm run test:ui
//
// Trois parcours sont joués par des pilotes injectés dans la page :
//   parcours-complet.js        perso.html : premier lancement → code → consentement → objectif → bilan complet → espace → historique → RGPD → effacement
//   parcours-rechargement.js   perso.html : état existant (deux bilans) → espace avec évolution → saisie manuelle → analyse simple → « Autre analyse »
//   parcours-admin.js          admin.html : connexion → tableau de bord → nouvel accès → usage réel → fiche, révocation, prolongation → activité → liens → réglages
// Pour perso.html, l'API /api/perso est remplacée par test/ui/mock-api.js. Pour admin.html, les vraies fonctions
// (api/admin.js, api/daf.js, api/perso.js) tournent dans le processus, sur le stockage mémoire, avec l'IA simulée.
"use strict";
process.env.ANTHROPIC_API_KEY = "test-key"; process.env.DAF_ACCESS_SECRET = "secret-de-test"; process.env.DAF_ADMIN_KEY = "admin-test";
process.env.DAF_DAILY_QUOTA = "10"; process.env.PERSO_DAILY_QUOTA = "5"; process.env.DAF_ACCOUNTS_MEMORY_OK = "1"; delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
const fs = require("fs"), path = require("path");
process.env.DAF_ADMINS = "adrien@exemple.com:" + require(path.join(__dirname, "..", "..", "lib", "auth.js")).hashPassword("mon mot de passe");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("jsdom manquant : lance d'abord  npm install --no-save jsdom"); process.exit(2); }

const ROOT = path.join(__dirname, "..", "..");
const mock = require("./mock-api.js");
const pages = {};
function page(name) { return pages[name] || (pages[name] = fs.readFileSync(path.join(ROOT, name), "utf8").replace(/<link[^>]+fonts[^>]*>/g, "")); }

// Fonctions serveur réelles pour le scénario console (IA simulée par un fetch Node).
const handlers = { "/api/admin": require(path.join(ROOT, "api", "admin.js")), "/api/daf": require(path.join(ROOT, "api", "daf.js")), "/api/perso": require(path.join(ROOT, "api", "perso.js")) };
global.fetch = async function (url, opts) {
  const body = JSON.parse(opts.body), schema = body.output_config.format.schema;
  const vide = s => { if (s.type === "array") return []; if (s.type === "object") { const o = {}; Object.keys(s.properties).forEach(k => { o[k] = vide(s.properties[k]); }); return o; } if (s.enum) return s.enum[0]; if (s.type === "number" || s.type === "integer") return 0; return "x"; };
  return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(vide(schema)) }], usage: { input_tokens: 2000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) };
};
function serverFetch(url, opts) {
  const fn = handlers[String(url).replace(/^https?:\/\/[^/]+/, "")];
  if (!fn) return Promise.reject(new Error("route inconnue : " + url));
  return new Promise(resolve => {
    const res = { statusCode: 200, setHeader() {}, status(s) { this.statusCode = s; return this; }, end(t) { resolve({ status: this.statusCode, text: () => Promise.resolve(t) }); } };
    fn({ method: "POST", body: JSON.parse(opts.body), headers: { "x-forwarded-for": "10.9.9." + Math.floor(Math.random() * 250) }, socket: {} }, res);
  });
}

function etatPrecharge() {
  // Deux bilans complets (audit 52 puis 60), un objectif, une résiliation.
  const run = (id, daysAgo, score) => {
    const r = { id: id, date: new Date(Date.now() - daysAgo * 864e5).toISOString(), label: "Bilan complet", modules: ["audit", "fuites", "treso", "dettes", "plan"], results: {}, errors: {}, etat: mock.ETAT, ctx: { prenom: "sam" } };
    r.modules.forEach(m => { r.results[m] = mock.rapport(m); }); r.results.audit.score.global = score; return r;
  };
  return { v: 1, code: "PXP-TEST", label: "TEST", product: "perso", consentAt: "2026-07-01T10:00:00.000Z", mode: "paste", text: "", form: { dettes: [], cats: {} }, ctx: { prenom: "sam", situation: "seul" }, checks: {}, history: [run("R2", 35, 60), run("R1", 70, 52)], goals: [{ id: "G1", nom: "Vacances", cible: 1200, deja: 300, date: "2027-06-01" }], cancelled: { "prlv basic fit": { montant: 29.99 } }, coussin: 3 };
}

function scenario(name, driverFile, mode, file) {
  const html = page(file || "perso.html");
  return new Promise(resolve => {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", e => { if (!/not implemented/i.test(e.message)) errors.push("jsdomError: " + e.message); });
    vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
    const dom = new JSDOM(html, {
      url: "http://localhost/" + (file ? file.replace(/\.html$/, "") : "perso") + "?mode=" + mode, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(window) {
        window.fetch = mode === "admin" ? serverFetch : (url, opts) => Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(mock.respond(JSON.parse(opts.body)))) });
        window.URL.createObjectURL = () => "blob:local"; window.URL.revokeObjectURL = () => {};
        window.scrollTo = () => {}; window.print = () => {};
        if (mode === "reload") window.localStorage.setItem("phenix.perso.v1", JSON.stringify(etatPrecharge()));
      }
    });
    const { window } = dom;
    window.addEventListener("error", e => errors.push("page error: " + e.message));
    setTimeout(() => { const s = window.document.createElement("script"); s.textContent = fs.readFileSync(path.join(__dirname, driverFile), "utf8"); window.document.body.appendChild(s); }, 50);
    const t0 = Date.now();
    (function poll() {
      const pre = window.document.getElementById("harness-log");
      const done = pre && pre.dataset.done === "1";
      // Le parcours complet se termine par « Tout effacer » (location.reload, non simulé par jsdom) : on constate l'effacement.
      const erased = mode === "full" && pre && !window.localStorage.getItem("phenix.perso.v1") && /export JSON/.test(pre.textContent);
      if (done || erased || Date.now() - t0 > 60000) {
        const lines = pre ? pre.textContent.split("\n") : ["FAIL aucun journal"];
        if (erased) lines.push("PASS mes données : effacement total (stockage local vide)");
        if (!done && !erased) lines.push("FAIL délai dépassé");
        const fails = lines.filter(l => /^FAIL/.test(l));
        console.log("\n" + name + " : " + (lines.length - fails.length) + " / " + lines.length + " vérifications" + (errors.length ? ", " + errors.length + " erreur(s) de page" : ""));
        fails.concat(errors.map(e => "   " + e)).forEach(l => console.log("  " + l));
        if (process.env.UI_VERBOSE) lines.forEach(l => console.log("  " + l));
        window.close();
        resolve(fails.length === 0 && errors.length === 0);
      } else setTimeout(poll, 100);
    })();
  });
}

(async () => {
  const a = await scenario("Parcours complet", "parcours-complet.js", "full");
  const b = await scenario("Rechargement, saisie manuelle, analyse simple", "parcours-rechargement.js", "reload");
  const c = await scenario("Console d'administration", "parcours-admin.js", "admin", "admin.html");
  process.exit(a && b && c ? 0 : 1);
})();
