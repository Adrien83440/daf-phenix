// Scénario console : connexion, tableau de bord, nouvel accès, usage réel remonté, fiche client, révocation, prolongation, activité, liens, réglages.
(function () {
  var log = [], fails = 0;
  var pre = document.createElement("pre"); pre.id = "harness-log"; pre.style.display = "none"; document.body.appendChild(pre);
  function ok(cond, msg) { log.push((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; pre.textContent = log.join("\n"); }
  function $(id) { return document.getElementById(id); }
  function txt(el) { return (el.textContent || "").replace(/[  ]/g, " "); }
  function wait(cond, ms) { return new Promise(function (res, rej) { var t0 = Date.now(); (function poll() { var v; try { v = cond(); } catch (e) {} if (v) return res(v); if (Date.now() - t0 > (ms || 8000)) return rej(new Error("timeout")); setTimeout(poll, 40); })(); }); }
  function click(id) { $(id).click(); }
  function setVal(id, v) { var el = $(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
  function on(v) { return $("v-" + v).classList.contains("on"); }
  function api(path, body) { return fetch(path, { method: "POST", body: JSON.stringify(body) }).then(function (r) { return r.text(); }).then(JSON.parse); }
  window.confirm = function () { return true; };

  (async function () {
    try {
      // connexion par e-mail et mot de passe
      ok(!$("login-account").hidden && $("login-key").hidden, "connexion : formulaire e-mail + mot de passe par défaut");
      setVal("login-email", "adrien@exemple.com"); setVal("login-password", "faux"); click("btn-login");
      await wait(function () { return $("login-err").textContent; });
      ok(/incorrect/.test($("login-err").textContent), "connexion : mot de passe refusé");
      click("btn-login-mode"); ok(!$("login-key").hidden && $("login-account").hidden, "connexion : bascule vers la clé admin");
      setVal("admin-key", "faux"); click("btn-login");
      await wait(function () { return /Connexion requise|incorrecte/.test($("login-err").textContent); });
      ok(true, "connexion : mauvaise clé refusée");
      click("btn-login-mode");
      setVal("login-email", "ADRIEN@exemple.com"); setVal("login-password", "mon mot de passe"); click("btn-login");
      await wait(function () { return !$("app").hidden; });
      ok(on("dash"), "connexion : tableau de bord affiché");
      var sess = JSON.parse(sessionStorage.getItem("daf.admin"));
      ok(sess && sess.token && !sess.key, "connexion : jeton de session gardé, pas de clé");
      await wait(function () { return /adrien@exemple.com/.test($("chip-who").textContent); });
      ok(true, "en-tête : compte connecté affiché");
      ok(!$("dash-warn").hidden && /Aucun stockage persistant/.test($("dash-warn").textContent), "tableau de bord : avertissement mémoire seule");
      ok(/Mémoire seule/.test($("chip-store").textContent), "en-tête : puce stockage");
      ok(/0 analyses/.test(txt($("dash-kpis"))), "tableau de bord : compteurs à zéro");
      ok($("dash-chart").querySelector("svg") && $("dash-chart").querySelectorAll("rect").length === 60, "tableau de bord : graphique 30 jours");

      // nouvel accès
      $("nav").querySelector('[data-v="new"]').click();
      ok(on("new"), "navigation : nouvel accès");
      setVal("n-product", "perso");
      ok($("n-months").value === "1", "nouvel accès : durée par défaut Perso = 1 mois");
      ok($("n-access").value === "account" && !$("n-access").disabled, "nouvel accès : compte e-mail proposé par défaut");
      click("btn-mint"); await wait(function () { return $("n-err").textContent; });
      ok(/nom/.test($("n-err").textContent), "nouvel accès : nom obligatoire");
      setVal("n-name", "Marie Dupont"); click("btn-mint"); await wait(function () { return /e-mail/.test($("n-err").textContent); });
      ok(true, "nouvel accès : e-mail obligatoire pour un compte");
      setVal("n-email", "marie@exemple.fr"); setVal("n-quota", "8"); setVal("n-note", "Essai");
      click("btn-mint"); await wait(function () { return !$("n-result").hidden; });
      var code = $("n-code").textContent, pw = $("n-account-pw").textContent;
      ok(/^PXP-MARIEDUPON-\d{4}-[A-Z0-9]{8}$/.test(code), "nouvel accès : code Perso généré en interne (" + code + ")");
      ok(!$("n-account-box").hidden && $("n-code-box").hidden && /^[a-z]+-[a-z]+-\d{4}$/.test(pw), "nouvel accès : identifiants affichés, code masqué (" + pw + ")");
      ok(/\/perso/.test($("n-msg").value) && $("n-msg").value.indexOf(pw) > -1 && $("n-msg").value.indexOf(code) < 0 && /8 bilans/.test($("n-msg").value), "nouvel accès : message avec lien, e-mail, mot de passe provisoire, sans code");
      ok(!$("n-mailto").hidden && /^mailto:marie@exemple.fr/.test($("n-mailto").href), "nouvel accès : lien e-mail");

      // l'abonnée se connecte avec ses identifiants, puis fait un bilan
      var lg = await api("/api/perso", { action: "login", email: "marie@exemple.fr", password: pw });
      ok(lg.ok && lg.code === code && lg.mustChange, "fonction Perso : connexion avec le provisoire, code renvoyé, changement demandé");
      var v = await api("/api/perso", { action: "verify", code: code });
      ok(v.ok && v.quota.limit === 8, "fonction Perso : quota personnalisé appliqué");
      var l = await api("/api/perso", { action: "lecture", code: code, runId: "R1", text: "x".repeat(60) });
      ok(l.ok, "fonction Perso : lecture");
      await api("/api/perso", { action: "analyse", code: code, runId: "R1", module: "audit", etat: {}, text: "" });
      click("btn-refresh"); await wait(function () { return /1 analyses/.test(txt($("dash-kpis"))); });
      ok(/2 appels/.test(txt($("dash-kpis"))), "tableau de bord : 1 analyse, 2 appels après usage");
      ok(/Persoactifs1/.test(txt($("dash-clients")).replace(/\s+/g, "")), "tableau de bord : 1 abonné Perso actif");
      ok($("dash-events").querySelectorAll("tr.row").length === 2, "tableau de bord : dernière activité");

      // clients
      $("nav").querySelector('[data-v="clients"]').click();
      await wait(function () { return $("clients-table").querySelector("tr.row"); });
      var row = $("clients-table").querySelector("tr.row");
      ok(/Marie Dupont/.test(row.textContent) && /1 \/ 8/.test(txt(row)) && /Actif/.test(row.textContent), "clients : ligne avec nom, quota du jour, statut");
      setVal("f-search", "introuvable");
      ok(!$("clients-table").querySelector("tr.row") && /0 \/ 1/.test($("f-count").textContent), "clients : recherche");
      setVal("f-search", "");
      $("f-product").querySelector('[data-p="pro"]').click();
      ok(!$("clients-table").querySelector("tr.row"), "clients : filtre produit");
      $("f-product").querySelector('[data-p=""]').click();
      $("clients-table").querySelector("tr.row").click();
      await wait(function () { return $("modal").classList.contains("on"); });
      ok(/Marie Dupont/.test($("modal-body").textContent) && $("m-email").value === "marie@exemple.fr", "fiche : ouverte avec les données");
      ok(/1 · 2 · 0/.test(txt($("modal-body"))), "fiche : analyses · appels · échecs");
      setVal("m-note", "Cliente test"); click("m-save");
      await wait(function () { return !$("modal").classList.contains("on"); });
      await wait(function () { return $("clients-table").querySelector("tr.row"); });
      $("clients-table").querySelector("tr.row").click(); await wait(function () { return $("modal").classList.contains("on"); });
      ok($("m-note").value === "Cliente test", "fiche : modification enregistrée");
      ok(/mot de passe provisoire, pas encore remplacé/.test($("modal-body").textContent) && $("m-reset-pw"), "fiche : compte affiché, réinitialisation possible");
      click("m-reset-pw"); await wait(function () { return /[a-z]+-[a-z]+-\d{4}/.test($("m-reset-out").textContent); });
      var pw2 = $("m-reset-out").querySelectorAll("b")[1].textContent;
      ok(/^[a-z]+-[a-z]+-\d{4}$/.test(pw2) && pw2 !== pw, "fiche : nouveau mot de passe provisoire (" + pw2 + ")");
      ok($("m-msg").value.indexOf(pw2) > -1, "fiche : message mis à jour avec le nouveau provisoire");
      ok(!(await api("/api/perso", { action: "login", email: "marie@exemple.fr", password: pw })).ok && (await api("/api/perso", { action: "login", email: "marie@exemple.fr", password: pw2 })).ok, "fiche : ancien provisoire refusé, nouveau accepté");
      click("m-revoke");
      await wait(function () { return !$("modal").classList.contains("on"); });
      await wait(function () { return /Révoqué/.test($("clients-table").textContent); });
      ok(true, "révocation : statut mis à jour");
      v = await api("/api/perso", { action: "verify", code: code });
      ok(!v.ok && /désactivé/.test(v.error), "révocation : la fonction Perso refuse le code");
      $("clients-table").querySelector("tr.row").click(); await wait(function () { return $("m-unrevoke"); });
      click("m-unrevoke"); await wait(function () { return !$("modal").classList.contains("on"); });
      await wait(function () { return /Actif/.test($("clients-table").textContent) && !/Révoqué/.test($("clients-table").textContent); });
      ok((await api("/api/perso", { action: "verify", code: code })).ok, "réactivation : le code fonctionne à nouveau");

      // prolongation
      $("clients-table").querySelector("tr.row").click(); await wait(function () { return $("m-extend"); });
      setVal("m-months", "3"); click("m-extend");
      await wait(function () { return on("new") && $("n-code").textContent !== code; });
      var code2 = $("n-code").textContent;
      ok(/^PXP-MARIEDUPON-/.test(code2) && /remplace/.test($("n-meta").textContent), "prolongation : nouveau code affiché avec le message");
      ok(!(await api("/api/perso", { action: "verify", code: code })).ok && (await api("/api/perso", { action: "verify", code: code2 })).ok, "prolongation : ancien code refusé, nouveau accepté");
      lg = await api("/api/perso", { action: "login", email: "marie@exemple.fr", password: pw2 });
      ok(lg.ok && lg.code === code2, "prolongation : le compte suit le nouveau code, mot de passe inchangé");
      $("nav").querySelector('[data-v="clients"]').click();
      await wait(function () { return /Remplacé/.test($("clients-table").textContent); });
      ok($("clients-table").querySelectorAll("tr.row").length === 2, "clients : ancien et nouveau code listés");

      // vérifier un code et enregistrer un code existant
      $("nav").querySelector('[data-v="new"]').click();
      setVal("c-code", code2); click("btn-check");
      await wait(function () { return $("c-out").textContent; });
      ok(/Valide/.test($("c-out").textContent) && /Marie Dupont/.test($("c-out").textContent), "vérifier : valide avec le nom");
      var mintPro = await api("/api/daf", { action: "mint", adminKey: "admin-test", name: "Le Comptoir", months: 12 });
      setVal("i-code", mintPro.code); setVal("i-name", "Le Comptoir (import)"); click("btn-import");
      await wait(function () { return $("i-code").value === ""; });
      $("nav").querySelector('[data-v="clients"]').click();
      await wait(function () { return /Comptoir/.test($("clients-table").textContent); });
      ok(/Le Comptoir \(import\)/.test($("clients-table").textContent) && $("clients-table").querySelectorAll(".badge.pro").length === 1, "import : code Pro enregistré et listé");

      // activité
      $("nav").querySelector('[data-v="activity"]').click();
      await wait(function () { return $("events-table").querySelectorAll("tr.row").length === 2; });
      ok(/lecture/.test($("events-table").textContent) && /analyse · audit/.test($("events-table").textContent), "activité : événements listés");
      ok($("days-table").querySelectorAll("tr").length === 31, "activité : 30 jours");
      $("a-errors").checked = true; $("a-errors").dispatchEvent(new Event("change", { bubbles: true }));
      ok(!$("events-table").querySelector("tr.row"), "activité : filtre erreurs");

      // liens & messages
      $("nav").querySelector('[data-v="links"]').click();
      ok($("links-list").querySelectorAll(".linkrow").length === 3 && /\/perso/.test($("links-list").textContent), "liens : trois adresses");
      setVal("tpl-perso", "Salut {nom}, ton code : {code}"); document.querySelector('[data-tpl-save="perso"]').click();
      ok(localStorage.getItem("daf.admin.tpl.perso") === "Salut {nom}, ton code : {code}", "messages : modèle enregistré");
      document.querySelector('[data-tpl-reset="perso"]').click();
      ok(!localStorage.getItem("daf.admin.tpl.perso") && /Bienvenue sur Phénix Perso/.test($("tpl-perso").value), "messages : texte par défaut rétabli");

      // réglages
      $("nav").querySelector('[data-v="settings"]').click();
      ok(/ANTHROPIC_API_KEY/.test($("settings-table").textContent) && /définie/.test($("settings-table").textContent), "réglages : variables");
      ok(/DAF_ADMINS/.test($("settings-table").textContent), "réglages : variable des comptes listée");
      ok(/Storage/.test($("settings-store").textContent), "réglages : guide KV affiché quand le stockage manque");
      await wait(function () { return /adrien@exemple.com/.test($("acc-table").textContent); });
      ok(/toi/.test($("acc-table").textContent) && /variable DAF_ADMINS/.test($("acc-table").textContent), "comptes : le mien, défini par la variable");
      ok(!$("acc-pw-current-wrap").hidden && $("acc-pw-email-wrap").hidden, "comptes : changement de mot de passe avec l'actuel");
      setVal("acc-pw-current", "faux"); setVal("acc-pw-new", "nouveau mot de passe"); click("acc-pw-save");
      await wait(function () { return $("acc-pw-err").textContent; });
      ok(/actuel incorrect/.test($("acc-pw-err").textContent), "comptes : mot de passe actuel vérifié");
      setVal("acc-pw-current", "mon mot de passe"); setVal("acc-pw-new", "nouveau mot de passe"); click("acc-pw-save");
      await wait(function () { return !$("acc-envline").hidden; });
      ok(/^adrien@exemple\.com:scrypt\$/.test($("acc-envline-txt").value), "comptes : sans KV, la ligne DAF_ADMINS est proposée");
      await wait(function () { return /la console/.test($("acc-table").textContent); });
      ok(true, "comptes : le compte passe « défini par la console »");
      var lg = await api("/api/admin", { action: "login", email: "adrien@exemple.com", password: "nouveau mot de passe" });
      ok(lg.ok, "comptes : le nouveau mot de passe fonctionne");
      setVal("acc-add-email", "assistant@exemple.com"); setVal("acc-add-pw", "assistant2026"); click("acc-add-save");
      await wait(function () { return /assistant@exemple.com/.test($("acc-table").textContent); });
      ok($("acc-table").querySelector("[data-acc-del]"), "comptes : compte ajouté, retirable");
      $("acc-table").querySelector("[data-acc-del]").click();
      await wait(function () { return !/assistant@exemple.com/.test($("acc-table").textContent); });
      ok(true, "comptes : compte retiré");

      // suppression
      $("nav").querySelector('[data-v="clients"]').click();
      var rows = $("clients-table").querySelectorAll("tr.row");
      rows[rows.length - 1].click(); await wait(function () { return $("m-delete"); });
      var deleted = $("modal-body").querySelector(".mono").textContent;
      click("m-delete"); await wait(function () { return !$("modal").classList.contains("on"); });
      await wait(function () { return $("clients-table").textContent.indexOf(deleted) < 0; });
      ok(true, "suppression : fiche retirée");
    } catch (e) { ok(false, "exception : " + (e && e.message) + " (vue : " + (document.querySelector("#app .view.on") || {}).id + ")"); }
    pre.dataset.done = "1";
  })();
})();
