// Scénario 2 : rechargement avec un état existant (localStorage préchargé par run.js), saisie manuelle, analyse simple, quota.
(function () {
  var log = [], fails = 0;
  var pre = document.createElement("pre"); pre.id = "harness-log"; pre.style.display = "none"; document.body.appendChild(pre);
  function ok(cond, msg) { log.push((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; pre.textContent = log.join("\n"); }
  function $(id) { return document.getElementById(id); }
  function on(id) { return $("s-" + id).classList.contains("on"); }
  function txt(el) { return (el.textContent || "").replace(/[  ]/g, " "); }
  function wait(cond, ms) { return new Promise(function (res, rej) { var t0 = Date.now(); (function poll() { var v; try { v = cond(); } catch (e) {} if (v) return res(v); if (Date.now() - t0 > (ms || 8000)) return rej(new Error("timeout")); setTimeout(poll, 50); })(); }); }
  function click(id) { $(id).click(); }
  function setVal(id, v) { var el = $(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
  HTMLAnchorElement.prototype.click = function () { window.__exported = this.download; };

  (async function () {
    try {
      await wait(function () { return on("home"); });
      ok(true, "rechargement : arrivée directe sur l'espace (code et consentement connus)");
      ok(/Bonjour Sam/.test($("home-title").textContent), "rechargement : prénom restitué (" + $("home-title").textContent + ")");
      ok(/Faire mon bilan du mois/.test($("btn-home-bilan-txt").textContent), "cycle : bilan du mois dû après 35 jours (" + $("btn-home-bilan-txt").textContent + ")");
      ok(/l'heure de ton bilan du mois/.test($("home-next-txt").textContent) && $("home-next").classList.contains("due"), "cycle : rappel en évidence");
      var grid = txt($("home-grid"));
      ok(/Cette semaine/.test(grid) && /En retard/.test(grid) && $("card-week").querySelectorAll("input[data-check]").length >= 1, "cycle : actions en retard listées à cocher");
      ok(/semaine 6 · jour 30 \/ 30/.test(grid), "cycle : semaine courante calculée (" + (grid.match(/semaine \d+ · jour \d+ \/ \d+/) || [""])[0] + ")");
      ok(/Tes progrès/.test(grid) && /2 mois/.test(grid) && /d'affilée/.test(grid), "progrès : série de 2 mois consécutifs");
      ok(/Libéré/.test(grid) && /29,99 €/.test(grid), "progrès : montant libéré");
      ok(/\+8 depuis le premier bilan/.test(grid), "progrès : évolution du score");
      ok($("card-situ").querySelector(".situ-empty") && /Décrire ma situation/.test($("card-situ").textContent), "situation : invitation quand rien n'est décrit");
      var tip = $("tip-txt").textContent; ok(tip.length > 30, "conseil de la semaine affiché");
      $("tip-next").click(); ok($("tip-txt").textContent !== tip && $("tip-txt").textContent.length > 30, "conseil : un autre");
      $("btn-ics").click(); ok(window.__exported === "bilan-phenix-perso.ics", "rappel mensuel : fichier agenda généré");
      ok(/Évolution/.test(grid) && $("home-grid").querySelectorAll(".spark").length === 2, "espace : évolution avec deux bilans (2 courbes)");
      ok(/\+8 depuis le/.test(grid), "espace : delta de score (+8)");
      ok(/Résilié/.test(grid) && /Libéré grâce à toi/.test(grid), "espace : résiliation restituée");
      await wait(function () { return $("client-chip").textContent === "Sam"; });
      ok(true, "rechargement : vérification du code en arrière-plan, puce mise à jour");

      // saisie manuelle
      click("btn-home-bilan"); await wait(function () { return on("data"); });
      document.querySelector('#seg button[data-mode="form"]').click();
      ok(/Passer à l'analyse/.test($("btn-data-txt").textContent), "saisie : libellé du bouton adapté");
      click("btn-data"); await wait(function () { return $("data-err").textContent; });
      ok(/revenus nets/.test($("data-err").textContent), "saisie : revenus obligatoires");
      setVal("f-rev", "2 400"); setVal("f-cat-logement", "850"); setVal("f-cat-alimentation", "380"); setVal("f-cat-transport", "90"); setVal("f-ep", "150"); setVal("f-epd", "3000"); setVal("f-solde", "640");
      click("f-add-dette"); var row = document.querySelector("#f-dettes .drow2");
      row.querySelector(".d-nom").value = "Crédit auto"; row.querySelector(".d-type").value = "credit_auto"; row.querySelector(".d-cap").value = "6 000"; row.querySelector(".d-taux").value = "4,2"; row.querySelector(".d-men").value = "230";
      setVal("f-rec", "Netflix 13,49\nSalle de sport 29,90");
      click("btn-data"); await wait(function () { return on("read"); });
      ok(/Chiffres déclarés/.test($("read-meta").textContent), "saisie : badge « chiffres déclarés »");
      var tot = txt($("etat-tot"));
      ok(/1 550 €/.test(tot), "saisie : dépenses totales = postes + mensualité du crédit reprise (" + tot.replace(/\s+/g, " ").trim() + ")");
      ok(/\+850 €/.test(tot), "saisie : reste calculé");
      ok(/6,3 %/.test(tot), "saisie : taux d'épargne sur l'épargne déclarée (150 / 2 400)");
      ok(/1,9 mois/.test(tot), "saisie : épargne de sécurité en mois (3 000 / 1 550)");
      ok(document.querySelectorAll("#e-rec .ri").length === 2 && /29,90 €/.test(txt($("e-rec"))), "saisie : abonnements parsés");
      ok(document.querySelectorAll("#e-dettes .drow2").length === 1, "saisie : dette reprise");
      // présélection du bilan du mois quand un bilan précédent existe
      ok($("mods").querySelector('.mod[data-k="suivi"].on') && $("mods").querySelector('.mod[data-k="audit"].on'), "choix : bilan du mois + audit présélectionnés");
      ok(/Lancer le bilan du mois \+ 1 analyse/.test($("btn-run-txt").textContent), "choix : libellé du bouton (" + $("btn-run-txt").textContent + ")");
      $("mods").querySelector('.mod[data-k="suivi"]').click(); $("mods").querySelector('.mod[data-k="audit"]').click();
      ok($("btn-run").disabled, "choix : plus rien de sélectionné");
      // analyse simple
      $("mods").querySelector('.mod[data-k="fuites"]').click();
      ok(/Lancer l'analyse/.test($("btn-run-txt").textContent), "analyse simple : bouton");
      ok(/Bilans aujourd'hui : 1 sur 5/.test($("run-hint").textContent), "quota affiché (" + $("run-hint").textContent + ")");
      click("btn-run"); await wait(function () { return on("result"); });
      ok($("tabs").hidden && document.querySelectorAll(".rapport").length === 1, "analyse simple : un seul rapport, pas d'onglets");
      ok(/Fuites d'argent/.test($("res-title").textContent), "analyse simple : titre");
      ok(!document.querySelector("#res-body .ring-num"), "analyse simple : pas de score hors audit");
      click("btn-res-home"); await wait(function () { return on("home"); });
      var saved = JSON.parse(localStorage.getItem("phenix.perso.v1"));
      ok(saved.history.length === 3 && saved.history[0].modules[0] === "fuites", "historique : 3 bilans, le plus récent en premier");
      ok($("home-grid").querySelector(".ring-num") && $("home-grid").querySelector(".ring-num").textContent === "60", "espace : le score vient du dernier audit disponible, pas du dernier bilan");
      // « Autre analyse » depuis un résultat
      click("btn-home-hist"); await wait(function () { return on("hist"); });
      document.querySelectorAll(".hi-row")[1].click(); await wait(function () { return on("result"); });
      click("btn-again"); await wait(function () { return on("read"); });
      ok(document.querySelector("#egrid input[data-k=revenus_mensuels]").value === "2180", "autre analyse : état du bilan rouvert rechargé");
      // bilan du mois seul
      $("mods").querySelector('.mod[data-k="fuites"]').click();
      $("mods").querySelector('.mod[data-k="suivi"]').click();
      ok(/^Lancer le bilan du mois$/.test($("btn-run-txt").textContent.trim()), "bilan du mois : bouton (" + $("btn-run-txt").textContent + ")");
      click("btn-run"); await wait(function () { return on("result"); }, 15000);
      var res = txt($("res-body"));
      ok(/Bilan du mois/.test($("res-title").textContent), "bilan du mois : titre");
      ok(/Depuis ton dernier bilan/.test(res) && /170 €/.test(res) && /260 €/.test(res) && /Mieux/.test(res), "bilan du mois : progrès avant → après");
      ok(/Ce que tu as fait/.test(res) && /Résilier Basic Fit/.test(res) && /Ce qui attend encore/.test(res), "bilan du mois : actions validées et en attente");
      ok(/Ton défi du mois/.test(res) && /Zéro découvert/.test(res) && /18 € d'agios/.test(res), "bilan du mois : défi");
      ok(document.querySelector("#res-body .ring-num").textContent === "61" && /Ton plan du mois/.test(res), "bilan du mois : score recalculé et plan du mois");
      click("btn-res-home"); await wait(function () { return on("home"); });
      ok($("home-grid").querySelector(".ring-num").textContent === "61" && /\+1 depuis le/.test(txt($("home-grid"))), "espace : score du bilan du mois avec delta (+1)");
      ok(/Jour 1 sur 30/.test($("home-next-txt").textContent), "cycle : nouveau mois démarré");
      saved = JSON.parse(localStorage.getItem("phenix.perso.v1"));
      ok(saved.history[0].label === "Bilan du mois" && saved.history[0].previousId, "historique : bilan du mois relié au précédent");
    } catch (e) { ok(false, "exception : " + (e && e.message) + " (écran : " + (document.querySelector(".screen.on") || {}).id + ")"); }
    pre.dataset.done = "1";
  })();
})();
