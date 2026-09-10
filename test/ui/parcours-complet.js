// Pilote de test : enchaîne le parcours complet dans la page et écrit le verdict dans <pre id="harness-log"> et document.title.
(function () {
  var log = [], fails = 0;
  var pre = document.createElement("pre"); pre.id = "harness-log"; pre.style.cssText = "position:fixed;left:0;top:0;z-index:999;background:#000;color:#0f0;font-size:10px;max-height:40vh;overflow:auto;display:none"; document.body.appendChild(pre);
  function ok(cond, msg) { log.push((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; pre.textContent = log.join("\n"); }
  function $(id) { return document.getElementById(id); }
  function on(id) { return $("s-" + id).classList.contains("on"); }
  function wait(cond, ms) { return new Promise(function (res, rej) { var t0 = Date.now(); (function poll() { var v; try { v = cond(); } catch (e) {} if (v) return res(v); if (Date.now() - t0 > (ms || 8000)) return rej(new Error("timeout")); setTimeout(poll, 50); })(); }); }
  function click(id) { $(id).click(); }
  function setVal(id, v) { var el = $(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
  var mode = new URLSearchParams(location.search).get("mode") || "full";
  var stopAt = new URLSearchParams(location.search).get("stop") || "";
  function txt(el) { return (el.textContent || "").replace(/[\u00a0\u202f\u2009\u2007\u2008]/g, " "); }
  function stop(name) { if (stopAt === name) { document.title = "HARNESS " + (fails ? "FAIL" : "OK"); pre.style.display = "none"; pre.dataset.done = "1"; throw { halt: true }; } }
  window.confirm = function () { return true; };
  // Après l'effacement, la page se recharge : on ne rejoue pas le parcours, on restitue le journal.
  try {
    var prev = sessionStorage.getItem("harness-log");
    if (prev) { sessionStorage.removeItem("harness-log"); log = JSON.parse(prev); fails = log.filter(function (l) { return /^FAIL/.test(l); }).length; ok(!localStorage.getItem("phenix.perso.v1"), "mes données : effacement total puis rechargement"); document.title = "HARNESS " + (fails ? "FAIL" : "OK"); pre.dataset.done = "1"; return; }
  } catch (e) {}
  HTMLAnchorElement.prototype.click = function () { window.__exported = this.download; };

  (async function () {
    try {
      await wait(function () { return on("gate"); });
      ok(true, "écran de connexion affiché au premier lancement");
      ok(!$("gate-account").hidden && $("gate-code").hidden, "connexion : e-mail + mot de passe par défaut, code en option");
      click("btn-gate-mode"); ok(!$("gate-code").hidden, "connexion : bascule vers le code");
      setVal("code", "PXP-FAUX"); click("btn-gate");
      await wait(function () { return $("gate-err").textContent.length > 5; });
      ok(/inconnu/i.test($("gate-err").textContent), "code refusé : " + $("gate-err").textContent);
      click("btn-gate-mode");
      setVal("g-email", "sam@exemple.fr"); setVal("g-pw", "faux"); click("btn-gate");
      await wait(function () { return /incorrect/.test($("gate-err").textContent); });
      ok(true, "connexion : mot de passe refusé");
      setVal("g-pw", "provisoire-1234"); click("btn-gate");
      await wait(function () { return on("pass"); });
      ok($("p-current-wrap").hidden && $("g-pw").value === "", "première connexion : écran du choix de mot de passe, provisoire retenu, champ vidé");
      setVal("p-new", "abcdefgh"); setVal("p-confirm", "different"); click("btn-pass");
      await wait(function () { return /identiques/.test($("pass-err").textContent); });
      ok(true, "mot de passe : confirmation vérifiée");
      setVal("p-new", "court"); setVal("p-confirm", "court"); click("btn-pass");
      await wait(function () { return /8 caractères/.test($("pass-err").textContent); });
      ok(true, "mot de passe : longueur minimale");
      setVal("p-new", "mon-mdp-perso"); setVal("p-confirm", "mon-mdp-perso"); click("btn-pass");
      await wait(function () { return on("consent"); });
      ok(true, "mot de passe enregistré, passage à la transparence");
      ok($("btn-consent").disabled, "consentement : bouton désactivé tant que la case n'est pas cochée");
      $("agree-in").checked = true; $("agree-in").dispatchEvent(new Event("change", { bubbles: true }));
      ok(!$("btn-consent").disabled, "consentement : bouton activé après la case");
      click("btn-priv-1"); ok($("modal-priv").classList.contains("on"), "politique de confidentialité ouverte");
      click("btn-modal-close"); ok(!$("modal-priv").classList.contains("on"), "politique fermée");
      click("btn-consent");
      await wait(function () { return on("situ"); });
      ok(/Parle-moi de toi/.test($("situ-title").textContent) && $("situ-starters").querySelectorAll("button").length === 5, "situation : écran d'accueil avec amorces");
      setVal("situ-txt", "trop court"); click("btn-situ-save");
      await wait(function () { return $("situ-err").textContent; });
      ok(/deux ou trois phrases/.test($("situ-err").textContent), "situation : texte trop court refusé");
      $("situ-starters").querySelector("button").click();
      ok(/^trop court\. Je vis $/.test($("situ-txt").value), "situation : amorce insérée à la suite (" + JSON.stringify($("situ-txt").value) + ")");
      setVal("situ-prenom", "sam"); setVal("situ-txt", "Je vis seul à Lyon, 2 180 € net. Loyer 780 €. Un crédit conso qui me pèse, et je finis souvent à découvert.");
      ok(/\/ 700$/.test($("situ-count").textContent) && /^1\d\d \//.test($("situ-count").textContent), "situation : compteur (" + $("situ-count").textContent + ")");
      $("situ-obj").querySelector("button").click(); ok($("situ-obj").querySelector("button.on"), "situation : objectif choisi");
      click("btn-situ-save");
      await wait(function () { return on("home"); });
      ok($("client-chip").textContent === "Sam" && /Bonjour Sam/.test($("home-title").textContent), "situation : prénom repris partout");
      ok(/Je vis seul à Lyon/.test($("card-situ").textContent) && /Mise à jour le/.test($("card-situ").textContent), "espace : carte Ma situation");
      ok(!$("home-onb").hidden, "espace : onboarding visible sans bilan");
      ok($("home-grid").querySelector("#card-goals"), "espace : carte objectifs présente sans bilan");
      var saved = JSON.parse(localStorage.getItem("phenix.perso.v1"));
      ok(saved && saved.consentAt && saved.code === "PXP-TEST" && saved.email === "sam@exemple.fr", "persistance : code obtenu par la connexion, e-mail et consentement enregistrés");
      stop("home-empty");

      // objectif
      setVal("g-nom", "Vacances"); setVal("g-cible", "1200"); setVal("g-deja", "300"); setVal("g-date", "2027-06-01"); click("g-add");
      await wait(function () { return $("goals").querySelector(".goal"); });
      ok(/Vacances/.test($("goals").textContent) && /300\s€\s\/\s1\s200\s€/.test(txt($("goals"))), "objectif ajouté avec progression : " + $("goals").querySelector(".g-top").textContent);
      ok(/\/ mois/.test($("goals").textContent), "objectif : effort mensuel calculé");

      // bilan
      click("btn-home-bilan");
      await wait(function () { return on("data"); });
      ok(!$("steps").hidden, "étapes visibles dans le parcours bilan");
      stop("data");
      ok(/Je vis seul à Lyon/.test($("data-situ-txt").textContent) && /Mettre à jour/.test($("btn-data-situ").textContent), "données : rappel de la situation avec bouton de mise à jour");
      click("btn-data");
      await wait(function () { return $("data-err").textContent; });
      ok(/quelques lignes/.test($("data-err").textContent), "données vides refusées");
      setVal("txt", "01/06 VIR SALAIRE ACME +2180,00\n02/06 PRLV LOYER -780,00\n05/06 PRLV NETFLIX -13,49\n05/06 PRLV BASIC FIT -29,99\n10/06 PRLV CREDIT CONSO -212,00");
      click("btn-data");
      await wait(function () { return on("read"); }, 10000);
      ok(/Lecture fiable/.test($("read-meta").textContent), "lecture : badge de confiance");
      ok(document.querySelectorAll("#cats input").length === 14, "lecture : 14 postes de dépenses éditables");
      ok(/Reste chaque mois/.test($("etat-tot").textContent) && /\+171\s€|\+170\s€/.test(txt($("etat-tot"))), "lecture : totaux calculés (" + $("etat-tot").textContent.replace(/\s+/g, " ").trim() + ")");
      ok(document.querySelectorAll("#e-rec .ri").length === 4, "lecture : 4 abonnements repérés");
      ok(document.querySelectorAll("#e-dettes .drow2").length === 1, "lecture : 1 dette repérée");
      stop("read");
      // édition d'un poste
      var alim = document.querySelector('#cats input[data-cat="alimentation"]'); alim.value = "400"; alim.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(function () { return /\+111\s€|\+110\s€/.test(txt($("etat-tot"))); });
      ok(true, "lecture : la modification d'un poste recalcule le reste");
      ok($("btn-run").disabled, "analyse : bouton désactivé sans module");
      $("mods").querySelector('.mod[data-k="all"]').click();
      ok(/bilan complet/i.test($("btn-run-txt").textContent), "analyse : bilan complet sélectionné");
      click("btn-run");
      await wait(function () { return on("result"); }, 15000);
      ok(document.querySelectorAll("#tabs button").length === 5, "résultats : 5 onglets");
      ok(document.querySelector(".tabpane.on .ring-num") && document.querySelector(".tabpane.on .ring-num").textContent === "52", "résultats : score 52 affiché");
      ok(document.querySelector(".tabpane.on .sbar") && /Budget/.test(document.querySelector(".tabpane.on .sbar").textContent), "résultats : axes perso (Budget…)");
      ok(document.querySelectorAll(".tabpane.on .check").length === 3, "résultats : plan 90 jours cochable");
      stop("result");
      document.querySelector('#tabs button[data-k="fuites"]').click();
      ok(/1\s596\s€/.test(document.querySelector('.tabpane[data-k="fuites"] .total').textContent.replace(/[\u00a0\u202f]/g, " ")), "résultats : total des fuites (1 596 € par an)");
      document.querySelector('#tabs button[data-k="dettes"]').click();
      ok(/Accélération douce/.test(document.querySelector('.tabpane[data-k="dettes"]').textContent), "résultats : stratégie dettes rendue");
      ok(/pas un conseil en investissement|ni un conseil en investissement/.test(document.querySelector("#s-result .disc").textContent), "résultats : avertissement légal présent");
      var first = document.querySelector('.tabpane[data-k="audit"] input[data-check]'); first.click();
      ok(first.checked, "résultats : action cochée");
      click("btn-res-home");
      await wait(function () { return on("home"); });
      ok($("home-onb").hidden, "espace : onboarding masqué après bilan");
      var grid = txt($("home-grid"));
      ok(/Score Phénix/.test(grid) && $("home-grid").querySelector(".ring-num").textContent === "52", "espace : score");
      ok(/Chaque mois/.test(grid) && /2 180 €/.test(grid), "espace : revenus (" + Array.from((grid.match(/nets.{0,8}/) || [""])[0]).map(function (c) { return c.charCodeAt(0); }).join(",") + ")");
      ok(/Épargne de sécurité/.test(grid) && /Il te manque/.test(grid), "espace : coussin de sécurité avec manque calculé");
      ok(/Abonnements/.test(grid) && document.querySelectorAll("#subs .ri").length === 4, "espace : abonnements");
      ok(/1 \/ 3/.test(grid), "espace : progression du plan (1 / 3) synchronisée avec la case cochée");
      ok(/Ton budget/.test(grid) && /Épargne de sécurité/.test(grid), "espace : budget (allocation)");
      ok(/Dettes/.test(grid) && /Accélération douce/.test(grid), "espace : dettes et stratégie");
      ok(!/Évolution/.test(grid), "espace : pas d'évolution avec un seul bilan");
      stop("home");
      // mise à jour de la situation depuis l'espace
      $("btn-situ-edit").click(); await wait(function () { return on("situ"); });
      ok(/Qu'est-ce qui a changé/.test($("situ-title").textContent) && /Je vis seul à Lyon/.test($("situ-txt").value) && /Annuler/.test($("btn-situ-skip").textContent), "situation : écran de mise à jour prérempli");
      click("btn-situ-skip"); await wait(function () { return on("home"); });
      $("btn-situ-edit").click(); await wait(function () { return on("situ"); });
      setVal("situ-txt", "Nouveau boulot depuis septembre : 2 400 € net. Le crédit conso se termine en mars. Je veux enfin une épargne de sécurité."); click("btn-situ-save");
      await wait(function () { return on("home") && /1 version précédente gardée/.test($("card-situ").textContent); });
      ok(/Nouveau boulot/.test($("card-situ").textContent), "situation : mise à jour, version précédente gardée");
      var st = JSON.parse(localStorage.getItem("phenix.perso.v1")).ctx;
      ok(st.historique_situation.length === 1 && /Je vis seul à Lyon/.test(st.historique_situation[0].texte) && st.historique_situation[0].date, "persistance : historique de situation daté");
      // résiliation d'un abonnement
      document.querySelector('#subs button[data-sub]').click();
      await wait(function () { return /Libéré grâce à toi/.test($("home-grid").textContent); });
      ok(/29,99 €|30 €/.test($("home-grid").querySelector(".freed").textContent.replace(/[\u00a0\u202f]/g, " ")), "espace : résiliation comptée (" + $("home-grid").querySelector(".freed").textContent.replace(/[\u00a0\u202f]/g, " ") + ")");
      // cible coussin
      var sel = $("coussin-sel"); sel.value = "6"; sel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(function () { return /6 mois de dépenses/.test($("home-grid").textContent); });
      ok(true, "espace : cible d'épargne modifiable");
      // cocher une action depuis l'espace
      var chk = $("home-grid").querySelector("input[data-check]"); chk.click();
      await wait(function () { return /2 \/ 3/.test($("home-grid").textContent); });
      ok(true, "espace : action cochée depuis l'espace (2 / 3)");
      // historique
      click("btn-home-hist");
      await wait(function () { return on("hist"); });
      ok(document.querySelectorAll(".hi-row").length === 1 && /Bilan complet/.test($("hist-list").textContent), "historique : 1 bilan complet");
      document.querySelector(".hi-row").click();
      await wait(function () { return on("result"); });
      ok(document.querySelector('.tabpane[data-k="audit"] input[data-check]').checked, "historique : cases cochées conservées");
      click("btn-res-home"); await wait(function () { return on("home"); });
      // RGPD
      click("btn-home-rgpd");
      await wait(function () { return on("rgpd"); });
      ok(/1 bilan/.test($("rgpd-list").textContent) && /1 objectif/.test($("rgpd-list").textContent), "mes données : inventaire");
      ok(/pris connaissance/.test($("rgpd-consent").textContent), "mes données : date de consentement");
      click("btn-export"); ok(/^phenix-perso-\d{4}-\d\d-\d\d\.json$/.test(window.__exported || ""), "mes données : export JSON (" + window.__exported + ")");
      // persistance et rechargement simulé
      saved = JSON.parse(localStorage.getItem("phenix.perso.v1"));
      ok(saved.history.length === 1 && saved.goals.length === 1 && Object.keys(saved.cancelled).length === 1 && saved.coussin === 6, "persistance : bilan, objectif, résiliation, cible");
      if (mode === "full") { sessionStorage.setItem("harness-log", JSON.stringify(log)); click("btn-erase"); return; }
    } catch (e) { if (e && e.halt) return; ok(false, "exception : " + (e && e.message) + " (écran : " + (document.querySelector(".screen.on") || {}).id + ")"); }
    document.title = "HARNESS " + (fails ? "FAIL" : "OK");
    if (mode !== "full") { var pre2 = $("harness-log"); pre2.style.display = "none"; }
    pre.dataset.done = "1";
  })();
})();
