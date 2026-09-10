// ============================================================================
//  Phénix Perso — fonction serveur (Vercel, Node CommonJS)
//  Version grand public de DAF Phénix : un directeur financier personnel pour
//  les particuliers. Même moteur (appel IA, limitation, signature des codes)
//  que api/daf.js, mais un persona, des prompts et des schémas propres, avec
//  un cadre légal strict : aucun conseil en investissement, aucun produit
//  financier recommandé, aucune intermédiation bancaire.
//
//  Variables d'environnement (en plus de celles de api/daf.js) :
//    PERSO_DAILY_QUOTA    bilans par jour et par code (défaut : 5 ; un bilan complet = 1)
//    PERSO_ACCESS_CODES   codes fixes optionnels : "CODE:Libellé:2026-12-31,AUTRE:Libellé"
//    PERSO_REVOKED        identifiants de codes Perso désactivés : "DUPONT,MARTIN"
//
//  Codes : "PXP-TAG-AAMM-SIGNATURE" (signés avec DAF_ACCESS_SECRET, espace de
//  signature distinct des codes Pro). Un code Pro (PHX-…) valide est aussi
//  accepté ici : un client entreprise a l'espace perso en bonus.
//
//  Actions (POST JSON) : verify | lecture | analyse | mint (admin) | ping
//
//  RGPD : la fonction ne journalise ni ne conserve les données reçues ; elles
//  transitent vers l'API Anthropic le temps du calcul (voir CONFORMITE-PERSO.md).
// ============================================================================
"use strict";
const crypto = require("crypto");
const core = require("./daf.js")._internal;

const QUOTA = Math.max(1, parseInt(process.env.PERSO_DAILY_QUOTA || "5", 10) || 5);
const SECRET = process.env.DAF_ACCESS_SECRET || "";
const ADMIN_KEY = process.env.DAF_ADMIN_KEY || "";
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ALLOW_ORIGIN = process.env.DAF_ALLOW_ORIGIN || "*";
const MAX_TEXT = 200000;
const RAW_EXCERPT = 30000;

// ---------------------------------------------------------------------------
//  Prompts
// ---------------------------------------------------------------------------
const SYSTEM = `Tu es Phénix Perso, directeur financier personnel. Tu aides un particulier vivant en France à comprendre son argent, à arrêter les fuites, à construire une épargne de sécurité, à se libérer de ses dettes et à tenir un budget qui lui ressemble. Tu tutoies, tu es direct, chaleureux et concret, sans jargon et sans jugement : tu ne fais pas la morale sur un café ou un restaurant, tu chiffres et tu priorises.

Cadre légal et déontologique (non négociable) :
1. Tu n'es ni conseiller en investissements financiers, ni courtier, ni intermédiaire en opérations de banque ou en assurance. Tu ne recommandes JAMAIS un placement, un produit financier, une action, une obligation, un fonds, une crypto-monnaie, un bien immobilier, une assurance-vie, un plan d'épargne, un contrat, une banque, un organisme de crédit, un courtier ou une marque. Tu ne donnes aucune prévision de rendement ni aucun avis sur un marché. Si la personne veut investir, tu réponds qu'il faut se faire accompagner par un conseiller agréé (conseiller en investissements financiers immatriculé à l'ORIAS, ou sa banque) et que tout investissement comporte un risque de perte. Tu peux parler d'une épargne de précaution "sur un livret sans risque, disponible à tout moment" de façon générique, sans nommer d'établissement ni de produit précis.
2. Tu ne conseilles pas de souscrire un crédit, un crédit renouvelable, un rachat ou un regroupement de crédits, ni de changer de banque pour une banque nommée. Tu expliques les mécanismes (ordre de remboursement, remboursement anticipé, renégociation, étalement) et tu renvoies vers les bons interlocuteurs : sa banque, un Point Conseil Budget (gratuit, labellisé par l'État) et, si les dettes ne sont plus tenables, la commission de surendettement de la Banque de France (procédure gratuite).
3. Pas de conseil fiscal ou juridique personnalisé : au plus une orientation générale, avec un renvoi vers impots.gouv.fr, France services, la CAF ou un professionnel.
4. Ton terrain, où tu es excellent : budget, reste à vivre, dépenses, abonnements, dettes, épargne de sécurité, objectifs, aides non réclamées, habitudes et automatisations.

Méthode :
5. Appuie-toi uniquement sur les données fournies. Ce que tu supposes va dans "hypotheses". N'invente jamais un montant, un commerçant ou une ligne absents des données.
6. Montants en euros arrondis (pas de centimes au-delà de 100 €), cohérents entre eux (mensuel × 12 = annuel ; pourcentages d'allocation qui totalisent exactement 100).
7. Concret : nomme les lignes telles qu'elles apparaissent, les montants, les dates ; chaque action doit pouvoir être faite cette semaine ou être datée. Priorise par impact en euros, puis par facilité.
8. Contexte français : reste à vivre, découvert autorisé et agios, frais bancaires, prélèvements SEPA, résiliation d'abonnement en ligne (résiliation "en trois clics"), assurances (résiliation possible après un an), crédit renouvelable, aides (CAF, APL, prime d'activité, chèque énergie, tarifs sociaux, bourse), droit au compte, Point Conseil Budget, surendettement. Cite un droit ou un dispositif seulement s'il sert l'action.
9. Si des informations manquent, pose au maximum 3 questions dans "questions", mais livre quand même la meilleure analyse possible avec ce que tu as.
10. Bienveillance : la personne peut être en difficulté. Zéro culpabilisation, des pas réalistes. Si tu vois un danger (découvert chronique, crédits renouvelables qui s'empilent, rejets de prélèvements, mensualités de crédit au-delà d'un tiers des revenus), dis-le clairement et oriente vers l'aide gratuite.
11. Réponds en français, uniquement dans le format JSON demandé. Laisse vides ([] , "" ou 0) les sections qui ne concernent pas l'analyse demandée.`;

const LECTURE_PROMPT = `Lis les données brutes ci-dessous (relevé de compte, export de l'application bancaire, capture d'écran, tableau de budget, saisie libre) et reconstitue la situation financière personnelle sur la période couverte.

Attendu :
- période (mois de début et de fin au format AAAA-MM, nombre de mois), type de source, ton niveau de confiance, situation devinée (une phrase : salarié seul, couple avec deux enfants, étudiant, retraité...) ;
- entrées et sorties par mois avec solde de fin de mois ;
- revenus nets mensuels moyens (salaires, pensions, aides CAF, allocations, revenus complémentaires, pensions alimentaires reçues) : hors virements entre ses propres comptes, hors remboursements entre amis, hors déblocage d'épargne ;
- détail des revenus par source ;
- dépenses mensuelles moyennes par catégorie (logement, énergie et télécoms, alimentation, transport, assurances, santé, enfants et éducation, abonnements et loisirs, shopping, restaurants et sorties, frais bancaires, impôts, mensualités de crédits, autres) ;
- épargne mensuelle (virements vers livrets ou comptes d'épargne) ; épargne disponible si un solde de livret est visible ; solde du compte en fin de période ; découvert autorisé si visible ;
- dettes identifiables (crédit conso, crédit renouvelable, crédit auto, crédit immobilier, prêt étudiant, découvert utilisé, dette familiale, dette d'impôts, autre) avec mensualité, capital restant si visible, taux si visible ;
- abonnements et prélèvements récurrents détectés (même libellé à intervalles réguliers) avec le montant mensuel ;
- jusqu'à 60 lignes notables : récurrentes, inhabituelles, doublons, montants élevés, frais bancaires, agios, rejets, achats impulsifs répétés ;
- alertes (découvert, rejets, retards, mois anormaux, crédit renouvelable, dépendance à une seule source de revenus) ;
- ce qui manque pour être précis.

Règles de lecture : ignore les virements entre comptes de la même personne pour les revenus ; un déblocage d'épargne ou un prêt reçu n'est pas un revenu ; convertis tout en mensuel moyen sur la période ; si un montant n'est pas déterminable, mets 0 et signale-le dans "manquant" ; ne cite aucun IBAN ni numéro de compte dans tes réponses ; si les données couvrent moins d'un mois, dis-le dans "alertes".`;

const MODULE_PROMPTS = {
  audit: `Analyse demandée : 01 · AUDIT DE TON ARGENT.
Agis comme le directeur financier personnel de cette personne. Analyse toute sa situation à partir de sa situation reconstituée, de son contexte et de ses objectifs. Trouve chaque fuite d'argent, chaque opportunité ratée (aide non réclamée, abonnement en doublon, frais évitables, revenu complémentaire réaliste) et chaque erreur de gestion. Note la santé financière de 0 à 100 (global) et sur cinq axes : budget (équilibre revenus/dépenses, reste à vivre), épargne (taux d'épargne, épargne mensuelle), dépenses (maîtrise, poids des fixes), dettes (poids des mensualités dans les revenus, coût, risque), securite (mois de dépenses couverts par l'épargne disponible, découvert, dépendance à une seule source). Puis construis le plan le plus simple pour redresser ses finances le plus vite possible, sur 90 jours, semaine par semaine (S1 à S12, 6 à 10 actions).
Remplis : score, kpis (4 à 6), diagnostic (constats, erreurs et points forts, avec gravité), fuites (les principales), opportunites (3 à 5, sans aucun produit financier), plan_90_jours, hypotheses, questions, mot_du_daf.
Laisse vides : allocation, dettes, strategie_dettes, feuille_de_route, automatisations.`,

  plan: `Analyse demandée : 02 · PLAN DE RICHESSE.
Conçois une feuille de route complète pour construire un patrimoine à partir d'où en est la personne aujourd'hui. Priorise dans cet ordre : 1) augmenter les revenus (négociation, évolution, aides et droits non réclamés, revenu complémentaire réaliste, vente d'objets inutilisés), 2) couper les dépenses inutiles, 3) constituer une épargne de sécurité (cible en mois de dépenses, montant, délai), 4) gérer les dettes (les plus chères d'abord), 5) préparer les projets à moyen terme (montant, date, effort mensuel), 6) bâtir une sécurité financière durable (budget stable, assurances utiles, habitudes, automatisations). Donne des objectifs chiffrés à 3, 6 et 12 mois (épargne de sécurité, taux d'épargne, dettes restantes, reste à vivre).
Rappel absolu : tu ne recommandes aucun placement, produit, contrat, établissement ni classe d'actifs. Pour l'étape "investir", tu indiques uniquement le montant qui pourrait être disponible chaque mois une fois la sécurité construite, et tu renvoies vers un conseiller agréé.
Remplis : kpis (objectifs chiffrés : aujourd'hui puis cible à 12 mois), diagnostic (où en est la personne sur chacun des 6 axes), opportunites (leviers de revenus et d'économies avec gain estimé), feuille_de_route (horizons "0-3 mois", "3-6 mois", "6-12 mois"), plan_90_jours (les 8 à 10 premières actions), hypotheses, questions, mot_du_daf.
Laisse vides : score, fuites, allocation, dettes, strategie_dettes, automatisations.`,

  treso: `Analyse demandée : 03 · OPTIMISATION DU CASH-FLOW.
Réorganise les finances de la personne pour que chaque euro qui rentre ait un rôle précis. Montre exactement quoi couper, quoi garder, quoi automatiser, et où doit aller l'argent chaque mois : logement et charges fixes, courses et vie quotidienne, transport, plaisirs et sorties, épargne de sécurité, projets, remboursements de dettes, imprévus. Propose une répartition en pourcentage des revenus nets (le total fait exactement 100) avec le montant mensuel correspondant et la règle à appliquer (par exemple : virement automatique vers le livret le lendemain de la paie, enveloppe courses hebdomadaire). Fixe une cible d'épargne de sécurité en mois de dépenses et le délai pour l'atteindre. Traite le calendrier des prélèvements (les regrouper après la paie), le découvert, les provisions pour les grosses dépenses annuelles (impôts, assurance, vacances, rentrée).
Remplis : kpis (reste à vivre actuel, taux d'épargne, cible d'épargne de sécurité, cash-flow mensuel après réorganisation), diagnostic (tensions, ce qui coince), allocation (7 à 9 postes), automatisations (virements, enveloppes, alertes, calendrier), fuites (uniquement ce qu'il faut couper, si pertinent), plan_90_jours (mise en place semaine par semaine), hypotheses, questions, mot_du_daf.
Laisse vides : score, opportunites, dettes, strategie_dettes, feuille_de_route.`,

  fuites: `Analyse demandée : 04 · FUITES D'ARGENT.
Analyse l'historique de dépenses ligne par ligne. Trouve chaque dépense inutile, abonnement oublié ou en doublon, essai gratuit devenu payant, application ou service non utilisé, achat impulsif répété, inflation du train de vie, frais bancaires et agios évitables, assurance redondante ou surdimensionnée, forfait trop cher, livraison et frais annexes, fuite cachée. Classe-les par coût annuel décroissant et dis quels changements font économiser le plus avec le moins d'impact sur le quotidien (impact "nul", "faible", ou "a_cadrer" : à décider en conscience, par exemple un loisir qui compte vraiment). Pour chaque fuite : la ligne précise telle qu'elle apparaît dans les données, la catégorie, le coût mensuel, le coût annuel (mensuel × 12), l'impact, et l'action concrète (comment résilier, quoi renégocier, quelle alternative moins chère sans nommer de marque, quelle habitude changer).
Remplis : kpis (total des fuites par an, part des revenus, nombre de lignes, gain immédiat sans impact), fuites (toutes celles que tu trouves, de 5 à 20), diagnostic (les habitudes qui créent les fuites, sans jugement), plan_90_jours (résiliations et renégociations dans l'ordre, surtout S1 à S4), hypotheses, questions, mot_du_daf.
Laisse vides : score, opportunites, allocation, dettes, strategie_dettes, feuille_de_route, automatisations.`,

  dettes: `Analyse demandée : 05 · DESTRUCTEUR DE DETTES.
Voici les dettes de la personne (crédits conso, crédit renouvelable, crédit auto, prêt étudiant, crédit immobilier, découvert, dettes familiales, dettes d'impôts). Crée la stratégie de remboursement la plus intelligente selon ses revenus, son cash-flow, ses taux et ses objectifs. Explique la logique choisie (avalanche : taux le plus élevé d'abord ; boule de neige : plus petit capital d'abord pour la motivation ; hybride ; remboursement anticipé ; renégociation avec sa banque ; étalement d'une dette d'impôts) et montre comment se libérer des dettes le plus efficacement possible sans mettre le quotidien en danger : garde une petite réserve d'imprévus avant d'accélérer. Donne l'ordre de priorité de chaque dette (priorite 1 = à traiter en premier), la mensualité totale cible, la durée actuelle et la durée optimisée en mois, les intérêts évités, et les leviers. Le crédit immobilier est en général la dette la moins urgente : dis-le si c'est le cas.
Interdits : recommander un rachat ou un regroupement de crédits, un nouveau crédit, un organisme ou un courtier. Si les mensualités dépassent un tiers des revenus ou si un crédit renouvelable sert à payer le quotidien, dis clairement qu'un rendez-vous gratuit avec un Point Conseil Budget s'impose, et rappelle l'existence de la procédure de surendettement de la Banque de France si la situation est bloquée.
Si aucune dette n'apparaît dans les données, dis-le clairement, concentre-toi sur la prévention (découvert, paiements en plusieurs fois, réserve d'imprévus) et précise ce qu'il faudrait fournir.
Remplis : kpis (total des dettes, mensualités et part des revenus, coût annuel des intérêts, mois avant libération), dettes (chacune avec priorite et action), strategie_dettes, diagnostic (risques : découvert, taux élevés, échéances proches), plan_90_jours (appels, renégociations, mises en place), hypotheses, questions, mot_du_daf.
Laisse vides : score, fuites, opportunites, allocation, feuille_de_route, automatisations.`
};

// ---------------------------------------------------------------------------
//  Schémas JSON (sortie structurée : toutes les propriétés sont requises)
// ---------------------------------------------------------------------------
function obj(props) { return { type: "object", additionalProperties: false, properties: props, required: Object.keys(props) }; }
function arr(items) { return { type: "array", items: items }; }
const S = { type: "string" }, N = { type: "number" }, I = { type: "integer" };

const CATEGORIES = ["logement", "energie_telecom", "alimentation", "transport", "assurances", "sante", "enfants_education", "abonnements_loisirs", "shopping", "restaurants_sorties", "frais_bancaires", "impots", "credits", "autres"];
const TYPES_DETTE = ["credit_conso", "credit_renouvelable", "credit_auto", "credit_immo", "pret_etudiant", "decouvert", "dette_familiale", "impots", "autre"];
const CATEGORIES_REC = ["streaming", "telecom", "logiciel_app", "sport", "assurance", "banque", "energie", "jeux", "presse", "autre"];

const ETAT_SCHEMA = obj({
  periode: obj({ debut: S, fin: S, nb_mois: I }),
  source: { type: "string", enum: ["releve_bancaire", "export_appli", "capture", "budget", "saisie", "mixte", "inconnu"] },
  confiance: { type: "string", enum: ["haute", "moyenne", "faible"] },
  situation_devinee: S,
  revenus_mensuels: N,
  revenus_detail: arr(obj({ source: S, montant_mensuel: N })),
  depenses: arr(obj({ categorie: { type: "string", enum: CATEGORIES }, montant_mensuel: N })),
  epargne_mensuelle: N, epargne_disponible: N, solde_fin_periode: N, decouvert_autorise: N,
  mois: arr(obj({ mois: S, entrees: N, sorties: N, solde_fin: N })),
  dettes: arr(obj({ nom: S, type: { type: "string", enum: TYPES_DETTE }, capital_restant: N, taux: N, mensualite: N, echeance: S })),
  recurrents: arr(obj({ libelle: S, montant_mensuel: N, categorie: { type: "string", enum: CATEGORIES_REC }, occurrences: I })),
  lignes_notables: arr(obj({ date: S, libelle: S, montant: N, categorie: S, remarque: S })),
  alertes: arr(S),
  manquant: arr(S)
});

const RAPPORT_SCHEMA = obj({
  titre: S,
  resume: { type: "string", description: "2 à 3 phrases, le constat principal et la promesse du plan" },
  score: obj({ global: I, budget: I, epargne: I, depenses: I, dettes: I, securite: I }),
  kpis: arr(obj({ label: S, valeur: { type: "string", description: "valeur formatée, ex : 1 250 € ou 2,1 mois" }, detail: S })),
  diagnostic: arr(obj({ titre: S, detail: S, gravite: { type: "string", enum: ["info", "attention", "critique"] } })),
  fuites: arr(obj({ poste: S, categorie: S, cout_mensuel: N, cout_annuel: N, impact: { type: "string", enum: ["nul", "faible", "a_cadrer"] }, action: S })),
  opportunites: arr(obj({ titre: S, gain_estime: S, effort: { type: "string", enum: ["faible", "moyen", "fort"] }, detail: S })),
  allocation: arr(obj({ poste: S, pourcentage: N, montant_mensuel: N, regle: S })),
  dettes: arr(obj({ nom: S, capital_restant: N, taux: N, mensualite: N, priorite: I, action: S })),
  strategie_dettes: obj({ nom: S, logique: S, mensualite_cible: N, duree_actuelle_mois: N, duree_optimisee_mois: N, interets_evites: N, leviers: arr(obj({ titre: S, detail: S })) }),
  feuille_de_route: arr(obj({ horizon: S, objectif: S, actions: arr(S), indicateur: S })),
  automatisations: arr(obj({ quoi: S, comment: S, frequence: S })),
  plan_90_jours: arr(obj({ semaine: { type: "string", description: "S1 à S12" }, action: S, impact: S, difficulte: { type: "string", enum: ["facile", "moyen", "dur"] } })),
  hypotheses: arr(S),
  questions: arr(S),
  mot_du_daf: { type: "string", description: "2 à 3 lignes, le mot de la fin du directeur financier personnel" }
});

// Comme pour la version Pro : le schéma complet dépasse la taille acceptée en
// sortie structurée, chaque module ne reçoit que ses sections, le serveur
// complète le reste avec des valeurs vides.
const RAPPORT_COMMUN = ["titre", "resume", "kpis", "diagnostic", "plan_90_jours", "hypotheses", "questions", "mot_du_daf"];
const RAPPORT_SECTIONS = {
  audit:  ["score", "fuites", "opportunites"],
  plan:   ["opportunites", "feuille_de_route"],
  treso:  ["allocation", "automatisations", "fuites"],
  fuites: ["fuites"],
  dettes: ["dettes", "strategie_dettes"]
};
function schemaRapport(mod) {
  const garde = RAPPORT_COMMUN.concat(RAPPORT_SECTIONS[mod] || []);
  const props = {};
  Object.keys(RAPPORT_SCHEMA.properties).forEach(function (k) { if (garde.indexOf(k) > -1) props[k] = RAPPORT_SCHEMA.properties[k]; });
  return obj(props);
}
function valeurVide(schema) {
  if (schema.type === "array") return [];
  if (schema.type === "object") { const o = {}; Object.keys(schema.properties).forEach(function (k) { o[k] = valeurVide(schema.properties[k]); }); return o; }
  if (schema.type === "number" || schema.type === "integer") return 0;
  return "";
}
function rapportComplet(data) {
  const out = {};
  Object.keys(RAPPORT_SCHEMA.properties).forEach(function (k) {
    out[k] = (data && data[k] !== undefined && data[k] !== null) ? data[k] : valeurVide(RAPPORT_SCHEMA.properties[k]);
  });
  return out;
}

// ---------------------------------------------------------------------------
//  Codes d'accès Perso (PXP-…), espace de signature distinct des codes Pro
// ---------------------------------------------------------------------------
function signPerso(tag, yymm) { return core.sign("PERSO~" + tag, yymm); }
function mintCode(name, months) {
  const tag = core.normTag(name);
  if (tag.length < 2) throw new Error("Nom trop court");
  const m = Math.max(1, Math.min(60, parseInt(months, 10) || 1));
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + m);
  const yymm = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, "0");
  const exp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { code: "PXP-" + tag + "-" + yymm + "-" + signPerso(tag, yymm), label: tag, expires: exp.toISOString().slice(0, 10), product: "perso" };
}
function staticCodes() {
  return String(process.env.PERSO_ACCESS_CODES || "").split(",").map(function (s) {
    const p = s.trim().split(":");
    return p[0] ? { code: p[0].trim().toUpperCase(), label: (p[1] || p[0]).trim(), expires: (p[2] || "").trim() } : null;
  }).filter(Boolean);
}
function checkCode(raw) {
  const code = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return { ok: false, error: "Entre ton code d'accès." };
  const today = new Date().toISOString().slice(0, 10);
  const st = staticCodes().find(function (c) { return c.code === code; });
  if (st) {
    if (st.expires && today > st.expires) return { ok: false, error: "Ce code a expiré. Renouvelle ton abonnement pour continuer." };
    return { ok: true, code: code, label: st.label, expires: st.expires || "", product: "perso" };
  }
  if (/^PHX-/.test(code)) {
    // Code Pro : accepté tel quel (l'espace perso est inclus pour les clients entreprise).
    const pro = core.checkCode(code);
    return pro.ok ? Object.assign({}, pro, { product: "pro" }) : pro;
  }
  const m = code.match(/^PXP-([A-Z0-9]{2,10})-(\d{4})-([A-Z0-9]{8})$/);
  if (!m) return { ok: false, error: "Code inconnu. Vérifie les tirets et les majuscules." };
  if (!SECRET) return { ok: false, error: "Serveur non configuré (DAF_ACCESS_SECRET manquant)." };
  const tag = m[1], yymm = m[2];
  if (signPerso(tag, yymm) !== m[3]) return { ok: false, error: "Code inconnu. Vérifie les tirets et les majuscules." };
  const revoked = String(process.env.PERSO_REVOKED || "").split(",").map(function (s) { return s.trim().toUpperCase(); });
  if (revoked.indexOf(tag) > -1) return { ok: false, error: "Cet accès a été désactivé." };
  const yy = 2000 + parseInt(yymm.slice(0, 2), 10), mm = parseInt(yymm.slice(2), 10);
  if (mm < 1 || mm > 12) return { ok: false, error: "Code invalide." };
  const exp = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));
  if (Date.now() > exp.getTime()) return { ok: false, error: "Ton accès a expiré le " + exp.toISOString().slice(0, 10) + ". Renouvelle ton abonnement pour continuer." };
  return { ok: true, code: code, label: tag, expires: exp.toISOString().slice(0, 10), product: "perso" };
}

// ---------------------------------------------------------------------------
//  Quota (mémoire de l'instance, comme la version Pro)
// ---------------------------------------------------------------------------
const usage = new Map();   // code -> { day, runs:Set }
function today() { return new Date().toISOString().slice(0, 10); }
function quotaState(code) {
  const d = today();
  let u = usage.get(code);
  if (!u || u.day !== d) { u = { day: d, runs: new Set() }; usage.set(code, u); }
  return u;
}
function consumeRun(code, runId) {
  const u = quotaState(code);
  if (runId && u.runs.has(runId)) return { ok: true, used: u.runs.size, limit: QUOTA };
  if (u.runs.size >= QUOTA) return { ok: false, used: u.runs.size, limit: QUOTA };
  u.runs.add(runId || crypto.randomUUID());
  return { ok: true, used: u.runs.size, limit: QUOTA };
}

// ---------------------------------------------------------------------------
//  Lecture et analyses
// ---------------------------------------------------------------------------
const SITUATIONS = { seul: "Vit seul(e)", couple: "En couple", couple_enfants: "En couple avec enfant(s)", seul_enfants: "Parent seul(e)", colocation: "En colocation ou chez ses parents" };
function ctxText(ctx) {
  ctx = ctx || {};
  const lines = [];
  if (ctx.prenom) lines.push("Prénom : " + String(ctx.prenom).slice(0, 40));
  if (ctx.situation) lines.push("Foyer : " + (SITUATIONS[ctx.situation] || ctx.situation));
  if (ctx.logement) lines.push("Logement : " + ctx.logement);
  if (ctx.statut) lines.push("Situation professionnelle : " + ctx.statut);
  if (ctx.age) lines.push("Tranche d'âge : " + ctx.age);
  if (ctx.objectif) lines.push("Objectif prioritaire : " + ctx.objectif);
  if (ctx.precisions) lines.push("Précisions de la personne : " + String(ctx.precisions).slice(0, 4000));
  return lines.length ? lines.join("\n") : "(aucun contexte fourni)";
}

async function lecture(body) {
  const text = String(body.text || "").slice(0, MAX_TEXT);
  const blocks = core.fileBlocks(body.files);
  if (!text.trim() && !blocks.length) throw new Error("Aucune donnée à lire : colle un relevé ou importe un fichier.");
  const content = blocks.concat([{ type: "text", text: LECTURE_PROMPT + "\n\nContexte donné par la personne :\n" + ctxText(body.context) + (blocks.length ? "\n\nLes fichiers joints (PDF ou images) font partie des données à lire." : "") + (text.trim() ? "\n\nDonnées brutes collées :\n<<<\n" + text + "\n>>>" : "") }]);
  return core.callClaude(content, ETAT_SCHEMA, 16000, SYSTEM);
}

async function analyse(body) {
  const mod = String(body.module || "");
  if (!MODULE_PROMPTS[mod]) throw new Error("Module inconnu.");
  if (!body.etat || typeof body.etat !== "object") throw new Error("Situation financière manquante.");
  const etatJson = JSON.stringify(body.etat).slice(0, 120000);
  const raw = String(body.text || "").slice(0, RAW_EXCERPT);
  const data = "Contexte de la personne :\n" + ctxText(body.context) + "\n\nSituation financière reconstituée (JSON, vérifiée par la personne) :\n" + etatJson + (raw.trim() ? "\n\nExtrait des données brutes, pour retrouver les libellés exacts :\n<<<\n" + raw + "\n>>>" : "");
  const content = [
    { type: "text", text: data, cache_control: { type: "ephemeral" } },
    { type: "text", text: MODULE_PROMPTS[mod] }
  ];
  const out = await core.callClaude(content, schemaRapport(mod), 20000, SYSTEM);
  return { data: rapportComplet(out.data), usage: out.usage };
}

// ---------------------------------------------------------------------------
//  Handler
// ---------------------------------------------------------------------------
function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { send(res, 405, { ok: false, error: "POST uniquement" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") { send(res, 400, { ok: false, error: "Corps JSON attendu" }); return; }

  const action = String(body.action || "analyse");
  const ip = String(req.headers["x-forwarded-for"] || req.socket && req.socket.remoteAddress || "?").split(",")[0].trim();
  if (core.rateLimited(ip)) { send(res, 429, { ok: false, error: "Trop de requêtes. Réessaie dans quelques minutes." }); return; }

  try {
    if (action === "ping") { send(res, 200, { ok: true, product: "perso", quota: QUOTA, configured: !!(API_KEY && SECRET && ADMIN_KEY) }); return; }

    if (action === "mint") {
      if (!ADMIN_KEY || String(body.adminKey || "") !== ADMIN_KEY) { send(res, 401, { ok: false, error: "Clé admin incorrecte." }); return; }
      if (!SECRET) { send(res, 500, { ok: false, error: "DAF_ACCESS_SECRET manquant côté serveur." }); return; }
      send(res, 200, Object.assign({ ok: true }, mintCode(body.name, body.months)));
      return;
    }

    const access = checkCode(body.code);
    if (!access.ok) { send(res, 401, access); return; }
    const q = quotaState(access.code);

    if (action === "verify") {
      send(res, 200, { ok: true, label: access.label, expires: access.expires, product: access.product, quota: { used: q.runs.size, limit: QUOTA } });
      return;
    }

    if (action === "lecture" || action === "analyse") {
      const runId = String(body.runId || "").slice(0, 64);
      const c = consumeRun(access.code, runId);
      if (!c.ok) { send(res, 429, { ok: false, error: "Tu as fait tes " + QUOTA + " bilans du jour. Reviens demain, tes analyses restent disponibles sur cet appareil.", quota: { used: c.used, limit: c.limit } }); return; }
      const out = action === "lecture" ? await lecture(body) : await analyse(body);
      send(res, 200, { ok: true, action: action, module: body.module || "", result: out.data, usage: out.usage, quota: { used: c.used, limit: c.limit } });
      return;
    }

    send(res, 400, { ok: false, error: "Action inconnue." });
  } catch (e) {
    send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};

module.exports._internal = { checkCode: checkCode, mintCode: mintCode, consumeRun: consumeRun, ETAT_SCHEMA: ETAT_SCHEMA, RAPPORT_SCHEMA: RAPPORT_SCHEMA, schemaRapport: schemaRapport, rapportComplet: rapportComplet, MODULE_PROMPTS: MODULE_PROMPTS, SYSTEM: SYSTEM, LECTURE_PROMPT: LECTURE_PROMPT, ctxText: ctxText, CATEGORIES: CATEGORIES, TYPES_DETTE: TYPES_DETTE, QUOTA: QUOTA };
