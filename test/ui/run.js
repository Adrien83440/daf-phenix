// Tests d'interface de perso.html dans jsdom (sans navigateur, sans réseau, sans IA).
//
//   npm install --no-save jsdom      (une fois ; jsdom n'est pas une dépendance du projet)
//   npm run test:ui
//
// Deux parcours sont joués par des pilotes injectés dans la page :
//   parcours-complet.js        premier lancement → code → consentement → objectif → bilan complet → espace → historique → RGPD → effacement
//   parcours-rechargement.js   état existant (deux bilans) → espace avec évolution → saisie manuelle → analyse simple → « Autre analyse »
// L'API /api/perso est remplacée par test/ui/mock-api.js.
"use strict";
const fs = require("fs"), path = require("path");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("jsdom manquant : lance d'abord  npm install --no-save jsdom"); process.exit(2); }

const ROOT = path.join(__dirname, "..", "..");
const mock = require("./mock-api.js");
const html = fs.readFileSync(path.join(ROOT, "perso.html"), "utf8").replace(/<link[^>]+fonts[^>]*>/g, "");

function etatPrecharge() {
  // Deux bilans complets (audit 52 puis 60), un objectif, une résiliation.
  const run = (id, daysAgo, score) => {
    const r = { id: id, date: new Date(Date.now() - daysAgo * 864e5).toISOString(), label: "Bilan complet", modules: ["audit", "fuites", "treso", "dettes", "plan"], results: {}, errors: {}, etat: mock.ETAT, ctx: { prenom: "sam" } };
    r.modules.forEach(m => { r.results[m] = mock.rapport(m); }); r.results.audit.score.global = score; return r;
  };
  return { v: 1, code: "PXP-TEST", label: "TEST", product: "perso", consentAt: "2026-07-01T10:00:00.000Z", mode: "paste", text: "", form: { dettes: [], cats: {} }, ctx: { prenom: "sam", situation: "seul" }, checks: {}, history: [run("R2", 35, 60), run("R1", 70, 52)], goals: [{ id: "G1", nom: "Vacances", cible: 1200, deja: 300, date: "2027-06-01" }], cancelled: { "prlv basic fit": { montant: 29.99 } }, coussin: 3 };
}

function scenario(name, driverFile, mode) {
  return new Promise(resolve => {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", e => { if (!/not implemented/i.test(e.message)) errors.push("jsdomError: " + e.message); });
    vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
    const dom = new JSDOM(html, {
      url: "http://localhost/perso?mode=" + mode, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(window) {
        window.fetch = (url, opts) => Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(mock.respond(JSON.parse(opts.body)))) });
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
  process.exit(a && b ? 0 : 1);
})();
