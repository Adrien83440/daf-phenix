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

  (async function () {
    try {
      await wait(function () { return on("home"); });
      ok(true, "rechargement : arrivée directe sur l'espace (code et consentement connus)");
      ok(/Bonjour Sam/.test($("home-title").textContent), "rechargement : prénom restitué (" + $("home-title").textContent + ")");
      ok(/Refaire un bilan/.test($("btn-home-bilan-txt").textContent), "rechargement : bouton « Refaire un bilan »");
      ok(/refaire ton bilan|Prochain bilan/.test($("home-next-txt").textContent), "rechargement : rappel de bilan (" + $("home-next-txt").textContent + ")");
      var grid = txt($("home-grid"));
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
    } catch (e) { ok(false, "exception : " + (e && e.message) + " (écran : " + (document.querySelector(".screen.on") || {}).id + ")"); }
    pre.dataset.done = "1";
  })();
})();
