// ============================================================================
//  DAF Phénix — fonction serveur (Vercel, Node CommonJS)
//
//  Variables d'environnement :
//    ANTHROPIC_API_KEY   clé API Anthropic (obligatoire)
//    DAF_ACCESS_SECRET   secret HMAC pour générer/vérifier les codes clients (obligatoire)
//    DAF_ADMIN_KEY       clé pour admin.html (générer des codes)            (obligatoire)
//    DAF_MODEL           modèle (défaut : claude-sonnet-5)
//    DAF_DAILY_QUOTA     analyses par jour et par code (défaut : 10)
//    DAF_ACCESS_CODES    codes fixes optionnels : "CODE:Libellé:2026-12-31,AUTRE:Libellé"
//    DAF_REVOKED         tags de codes désactivés, séparés par des virgules : "DUPONT,MARTIN"
//    DAF_ALLOW_ORIGIN    origine autorisée en CORS (défaut : *)
//    DAF_BRIDGE_KEY      clé partagée avec l'Academy : les requêtes portant ce secret (en-tête x-daf-bridge)
//                        sautent le code d'accès, le quota et la limite IP (l'Academy gère l'accès et le quota)
//
//  Actions (POST JSON) : verify | lecture | analyse | mint (admin) | ping
// ============================================================================
"use strict";
const crypto = require("crypto");

const MODEL = process.env.DAF_MODEL || "claude-sonnet-5";
const QUOTA = Math.max(1, parseInt(process.env.DAF_DAILY_QUOTA || "10", 10) || 10);
const SECRET = process.env.DAF_ACCESS_SECRET || "";
const ADMIN_KEY = process.env.DAF_ADMIN_KEY || "";
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ALLOW_ORIGIN = process.env.DAF_ALLOW_ORIGIN || "*";
const BRIDGE_KEY = process.env.DAF_BRIDGE_KEY || "";
const MAX_TEXT = 200000;          // caractères de données brutes acceptés
const MAX_FILES = 5;
const MAX_FILES_BYTES = 3.6e6;    // base64 cumulé (corps Vercel limité à 4,5 Mo)
const RAW_EXCERPT = 30000;        // extrait brut transmis aux modules d'analyse
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// ---------------------------------------------------------------------------
//  Prompts (le cœur du produit — côté serveur, jamais exposés au navigateur)
// ---------------------------------------------------------------------------
const SYSTEM = `Tu es DAF Phénix, directeur financier externalisé pour les TPE et PME françaises : commerçants, artisans, restaurateurs, prestataires, coachs, e-commerçants, agences, indépendants. Tu parles au dirigeant en le tutoyant, de façon directe, chaleureuse et concrète, sans jargon inutile. Tu raisonnes comme un DAF de terrain : chiffres, priorités, actions datées, impact estimé.

Règles :
1. Appuie-toi uniquement sur les données fournies. Quand tu dois estimer ou supposer, écris-le dans "hypotheses". N'invente jamais un montant, un fournisseur ou une ligne qui n'existe pas dans les données.
2. Montants en euros arrondis (pas de centimes au-delà de 100 €) et cohérents entre eux (coût mensuel × 12 = coût annuel ; pourcentages d'allocation qui totalisent 100).
3. Sois concret : nomme les postes, les fournisseurs, les montants, les échéances, les personnes à appeler. Chaque action doit pouvoir être faite cette semaine ou être datée.
4. Contexte français : TVA, Urssaf, IS, CFE, PGE, découvert autorisé, affacturage, délais de paiement, BPI, expert-comptable, prélèvements SEPA, frais bancaires pro, commissions CB.
5. Si des informations manquent pour être précis, pose au maximum 3 questions dans "questions", mais livre quand même la meilleure analyse possible avec ce que tu as.
6. Pas de conseil juridique ou fiscal engageant : quand un choix a des implications fiscales ou sociales, recommande de le valider avec l'expert-comptable (une seule fois par rapport, pas à chaque ligne).
7. Priorise toujours par impact financier puis par facilité de mise en œuvre. Le dirigeant est occupé : va à l'essentiel, zéro remplissage, zéro généralité.
8. Réponds en français, uniquement dans le format JSON demandé. Laisse vides ([] , "" ou 0) les sections qui ne concernent pas l'analyse demandée.`;

const LECTURE_PROMPT = `Lis les données brutes ci-dessous (relevé bancaire, export comptable, bilan, compte de résultat, journal de caisse, capture d'écran ou saisie libre) et reconstitue l'état financier de l'entreprise sur la période couverte.

Attendu :
- période (mois de début et de fin au format AAAA-MM, nombre de mois), type de source, ton niveau de confiance, activité devinée ;
- encaissements et décaissements par mois avec solde de fin de mois ;
- CA mensuel moyen (encaissements clients uniquement : hors virements internes, apports, emprunts, remboursements) ;
- charges fixes mensuelles récurrentes (loyer, assurances, abonnements, télécoms, échéances de prêts) ;
- charges variables mensuelles (achats, matières, sous-traitance, marketing, livraisons) ;
- masse salariale mensuelle (salaires + charges, hors dirigeant) ;
- rémunération mensuelle du dirigeant ;
- impôts et taxes mensuels (TVA nette, Urssaf, IS, CFE) ;
- trésorerie en fin de période ; découvert autorisé si visible ;
- dettes identifiables (prêts, PGE, découvert, leasing, Urssaf, fiscal, fournisseurs) avec mensualité, capital restant si visible, taux si visible ;
- dépenses récurrentes détectées (même libellé à intervalles réguliers), avec le montant mensuel ;
- jusqu'à 60 lignes notables : récurrentes, inhabituelles, doublons, montants élevés, frais bancaires, agios, rejets ;
- alertes (découvert, rejets, retards, incohérences, mois anormaux) ;
- ce qui manque pour être précis.

Règles de lecture : ignore les virements entre comptes de l'entreprise pour le CA ; distingue apports en capital et emprunts (ce n'est pas du CA) ; convertis tout en mensuel moyen sur la période ; si un montant n'est pas déterminable, mets 0 et signale-le dans "manquant" ; pour un bilan ou un compte de résultat annuel, divise par 12 pour obtenir les mensuels et dis-le dans "alertes".`;

const MODULE_PROMPTS = {
  audit: `Analyse demandée : 01 · AUDIT FINANCIER.
Agis comme le directeur financier de cette entreprise. Analyse toute sa situation à partir de l'état financier, du contexte et des objectifs. Trouve chaque fuite d'argent, chaque opportunité ratée et chaque erreur de gestion. Note la santé financière de 0 à 100 (global) et sur cinq axes : rentabilité (marge, résultat), trésorerie (mois de charges couverts, tension), charges (maîtrise, poids des fixes), dettes (poids, coût, risque), résilience (dépendance à quelques clients, saisonnalité, réserve). Puis construis le plan le plus simple pour renforcer les finances le plus vite possible, sur 90 jours, semaine par semaine (S1 à S12, 6 à 10 actions).
Remplis : score, kpis (4 à 6), diagnostic (constats, erreurs et points forts, avec gravité), fuites (les principales), opportunites (3 à 5), plan_90_jours, hypotheses, questions, mot_du_daf.
Laisse vides : allocation, dettes, strategie_dettes, feuille_de_route, automatisations.`,

  plan: `Analyse demandée : 02 · PLAN DE CROISSANCE.
Conçois une feuille de route complète pour bâtir un patrimoine d'entreprise solide à partir d'où elle en est aujourd'hui. Priorise dans cet ordre : 1) augmenter le chiffre d'affaires et les marges (prix, offre, récurrence, panier moyen, relances, clients dormants), 2) couper les dépenses inutiles, 3) constituer une réserve de trésorerie (cible en mois de charges), 4) gérer les dettes, 5) investir intelligemment (outils, recrutement, marketing, équipement) uniquement quand la réserve le permet, 6) bâtir une sécurité financière durable pour l'entreprise et pour le dirigeant (rémunération régulière, épargne, protection). Donne des objectifs chiffrés à 3, 6 et 12 mois (CA, marge, réserve, dettes).
Remplis : kpis (objectifs chiffrés : aujourd'hui puis cible à 12 mois), diagnostic (où en est l'entreprise sur chacun des 6 axes), opportunites (leviers de revenus et de marge avec gain estimé), feuille_de_route (horizons "0-3 mois", "3-6 mois", "6-12 mois"), plan_90_jours (les 8 à 10 premières actions), hypotheses, questions, mot_du_daf.
Laisse vides : score, fuites, allocation, dettes, strategie_dettes, automatisations.`,

  treso: `Analyse demandée : 03 · OPTIMISATION DE LA TRÉSORERIE.
Réorganise les finances de l'entreprise pour que chaque euro encaissé ait un rôle précis. Montre exactement quoi couper, quoi garder, quoi automatiser, et où doit aller l'argent chaque mois : charges fixes, charges variables, salaires, TVA et charges sociales à provisionner, réserve de sécurité, rémunération du dirigeant, remboursements de dettes, investissement. Propose une répartition en pourcentage du CA encaissé (le total fait exactement 100) avec le montant mensuel correspondant et la règle à appliquer (par exemple : virement automatique le 5 du mois vers un compte dédié). Fixe une cible de réserve en mois de charges et le délai pour l'atteindre. Traite les délais de paiement clients et fournisseurs, les acomptes, les relances, les provisions de TVA.
Remplis : kpis (trésorerie actuelle, mois de charges couverts, cible de réserve, cash-flow mensuel), diagnostic (tensions, ce qui coince), allocation (7 à 9 postes), automatisations (virements, provisions, relances, alertes), fuites (uniquement ce qu'il faut couper, si pertinent), plan_90_jours (mise en place semaine par semaine), hypotheses, questions, mot_du_daf.
Laisse vides : score, opportunites, dettes, strategie_dettes, feuille_de_route.`,

  fuites: `Analyse demandée : 04 · FUITES D'ARGENT.
Analyse l'historique de dépenses ligne par ligne. Trouve chaque dépense inutile, abonnement ou logiciel oublié ou en doublon, licence non utilisée, achat impulsif ou hors process, inflation des frais généraux, frais bancaires et commissions excessifs, pénalités et agios, assurance redondante, fournisseur trop cher, fuite cachée. Classe-les par coût annuel décroissant et dis quels changements font économiser le plus avec le moins d'impact sur l'activité (impact "nul", "faible", ou "a_cadrer" avec l'équipe). Pour chaque fuite : le poste précis tel qu'il apparaît dans les données, la catégorie, le coût mensuel, le coût annuel (mensuel × 12), l'impact, et l'action concrète (qui appeler, quoi résilier, quoi renégocier, alternative moins chère).
Remplis : kpis (total des fuites par an, part du CA, nombre de lignes, gain immédiat sans impact), fuites (toutes celles que tu trouves, de 5 à 20), diagnostic (les habitudes qui créent les fuites), plan_90_jours (résiliations et renégociations dans l'ordre, surtout S1 à S4), hypotheses, questions, mot_du_daf.
Laisse vides : score, opportunites, allocation, dettes, strategie_dettes, feuille_de_route, automatisations.`,

  dettes: `Analyse demandée : 05 · DESTRUCTEUR DE DETTES.
Voici les dettes de l'entreprise (prêts pro, PGE, découvert, leasing, dettes Urssaf ou fiscales, fournisseurs). Crée la stratégie de remboursement la plus intelligente selon le CA, le cash-flow, les taux et les objectifs. Explique la logique choisie (avalanche : taux le plus élevé d'abord ; boule de neige : plus petit capital d'abord ; hybride ; renégociation ; étalement Urssaf ou fiscal ; rachat ou regroupement ; remboursement anticipé) et montre comment libérer l'entreprise de ses dettes le plus efficacement possible sans mettre la trésorerie en danger : garde une réserve minimale avant d'accélérer. Donne l'ordre de priorité de chaque dette (priorite 1 = à traiter en premier), la mensualité totale cible, la durée actuelle et la durée optimisée en mois, les intérêts évités, et les leviers (renégociation de taux, étalement, arrêt du découvert, affacturage, aide BPI, apport). Si aucune dette n'apparaît dans les données, dis-le clairement, concentre-toi sur la prévention (découvert, délais fournisseurs, provisions) et précise ce qu'il faudrait fournir.
Remplis : kpis (total des dettes, mensualités, coût annuel des intérêts, mois avant libération), dettes (chacune avec priorite et action), strategie_dettes, diagnostic (risques : découvert, taux élevés, échéances proches), plan_90_jours (appels, renégociations, mises en place), hypotheses, questions, mot_du_daf.
Laisse vides : score, fuites, opportunites, allocation, feuille_de_route, automatisations.`
};

// ---------------------------------------------------------------------------
//  Schémas JSON (sortie structurée : toutes les propriétés sont requises)
// ---------------------------------------------------------------------------
function obj(props) {
  return { type: "object", additionalProperties: false, properties: props, required: Object.keys(props) };
}
function arr(items) { return { type: "array", items: items }; }
const S = { type: "string" }, N = { type: "number" }, I = { type: "integer" };

const ETAT_SCHEMA = obj({
  periode: obj({ debut: S, fin: S, nb_mois: I }),
  source: { type: "string", enum: ["releve_bancaire", "export_comptable", "bilan", "caisse", "saisie", "mixte", "inconnu"] },
  confiance: { type: "string", enum: ["haute", "moyenne", "faible"] },
  activite_devinee: S,
  ca_mensuel_moyen: N, charges_fixes_mensuelles: N, charges_variables_mensuelles: N, masse_salariale_mensuelle: N,
  remuneration_dirigeant_mensuelle: N, impots_taxes_mensuels: N, tresorerie_fin_periode: N, decouvert_autorise: N,
  mois: arr(obj({ mois: S, encaissements: N, decaissements: N, solde_fin: N })),
  dettes: arr(obj({ nom: S, type: { type: "string", enum: ["pret", "pge", "decouvert", "leasing", "urssaf", "fiscal", "fournisseur", "autre"] }, capital_restant: N, taux: N, mensualite: N, echeance: S })),
  recurrents: arr(obj({ libelle: S, montant_mensuel: N, categorie: { type: "string", enum: ["abonnement", "logiciel", "assurance", "loyer", "telecom", "banque", "energie", "pret", "autre"] }, occurrences: I })),
  lignes_notables: arr(obj({ date: S, libelle: S, montant: N, categorie: S, remarque: S })),
  alertes: arr(S),
  manquant: arr(S)
});

const RAPPORT_SCHEMA = obj({
  titre: S,
  resume: { type: "string", description: "2 à 3 phrases, le constat principal et la promesse du plan" },
  score: obj({ global: I, rentabilite: I, tresorerie: I, charges: I, dettes: I, resilience: I }),
  kpis: arr(obj({ label: S, valeur: { type: "string", description: "valeur formatée, ex : 18 450 € ou 2,1 mois" }, detail: S })),
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
  mot_du_daf: { type: "string", description: "2 à 3 lignes, le mot de la fin du DAF au dirigeant" }
});

// ---------------------------------------------------------------------------
//  Codes d'accès
// ---------------------------------------------------------------------------
function normTag(name) {
  return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}
function sign(tag, yymm) {
  const d = crypto.createHmac("sha256", SECRET).update(tag + "|" + yymm).digest();
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[d[i] % ALPHABET.length];
  return out;
}
function mintCode(name, months) {
  const tag = normTag(name);
  if (tag.length < 2) throw new Error("Nom de client trop court");
  const m = Math.max(1, Math.min(60, parseInt(months, 10) || 12));
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + m);
  const yymm = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, "0");
  const exp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { code: "PHX-" + tag + "-" + yymm + "-" + sign(tag, yymm), label: tag, expires: exp.toISOString().slice(0, 10) };
}
function staticCodes() {
  return String(process.env.DAF_ACCESS_CODES || "").split(",").map(function (s) {
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
    if (st.expires && today > st.expires) return { ok: false, error: "Ce code a expiré. Contacte l'équipe Phénix pour le renouveler." };
    return { ok: true, code: code, label: st.label, expires: st.expires || "" };
  }
  const m = code.match(/^PHX-([A-Z0-9]{2,10})-(\d{4})-([A-Z0-9]{8})$/);
  if (!m) return { ok: false, error: "Code inconnu. Vérifie les tirets et les majuscules." };
  if (!SECRET) return { ok: false, error: "Serveur non configuré (DAF_ACCESS_SECRET manquant)." };
  const tag = m[1], yymm = m[2];
  if (sign(tag, yymm) !== m[3]) return { ok: false, error: "Code inconnu. Vérifie les tirets et les majuscules." };
  const revoked = String(process.env.DAF_REVOKED || "").split(",").map(function (s) { return s.trim().toUpperCase(); });
  if (revoked.indexOf(tag) > -1) return { ok: false, error: "Cet accès a été désactivé." };
  const yy = 2000 + parseInt(yymm.slice(0, 2), 10), mm = parseInt(yymm.slice(2), 10);
  if (mm < 1 || mm > 12) return { ok: false, error: "Code invalide." };
  const exp = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));
  if (Date.now() > exp.getTime()) return { ok: false, error: "Cet accès a expiré le " + exp.toISOString().slice(0, 10) + ". Contacte l'équipe Phénix pour le renouveler." };
  return { ok: true, code: code, label: tag, expires: exp.toISOString().slice(0, 10) };
}

// ---------------------------------------------------------------------------
//  Quotas et limitation (mémoire de l'instance : protection souple)
// ---------------------------------------------------------------------------
const usage = new Map();   // code -> { day, runs:Set }
const hits = new Map();    // ip -> [timestamps]
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
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(function (t) { return now - t < 600000; });
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 80;
}

// ---------------------------------------------------------------------------
//  Appel Claude (sortie JSON structurée, prompt caching sur le préfixe)
// ---------------------------------------------------------------------------
async function callClaude(content, schema, maxTokens) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY manquante côté serveur.");
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 285000);
  let r, j;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: content }],
        output_config: { format: { type: "json_schema", schema: schema } }
      }),
      signal: ctrl.signal
    });
    j = await r.json();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "L'analyse a pris trop de temps. Réduis la quantité de données et relance." : "Connexion à l'IA impossible : " + e.message);
  } finally { clearTimeout(timer); }
  if (!r.ok) throw new Error("IA : " + ((j && j.error && j.error.message) || ("erreur " + r.status)));
  if (j.stop_reason === "refusal") throw new Error("L'IA n'a pas pu traiter ces données. Vérifie qu'il s'agit bien de données financières.");
  if (j.stop_reason === "max_tokens") throw new Error("Réponse trop longue. Réduis la période ou le nombre de lignes et relance.");
  const text = (j.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("");
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error("Réponse IA illisible, relance l'analyse."); }
  return { data: data, usage: j.usage || {} };
}

function fileBlocks(files) {
  files = Array.isArray(files) ? files.slice(0, MAX_FILES) : [];
  let total = 0;
  const blocks = [];
  files.forEach(function (f) {
    if (!f || !f.data || !f.type) return;
    total += f.data.length;
    if (total > MAX_FILES_BYTES) throw new Error("Fichiers trop lourds (3,5 Mo max au total). Retire un fichier ou compresse-le.");
    if (f.type === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: String(f.name || "document").slice(0, 120) });
    else if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) blocks.push({ type: "image", source: { type: "base64", media_type: f.type, data: f.data } });
  });
  return blocks;
}

function ctxText(ctx) {
  ctx = ctx || {};
  const lines = [];
  if (ctx.entreprise) lines.push("Entreprise : " + ctx.entreprise);
  if (ctx.secteur) lines.push("Secteur : " + ctx.secteur + (ctx.secteur_autre ? " (" + ctx.secteur_autre + ")" : ""));
  if (ctx.effectif) lines.push("Effectif : " + ctx.effectif);
  if (ctx.statut) lines.push("Statut juridique : " + ctx.statut);
  if (ctx.objectif) lines.push("Objectif prioritaire du dirigeant : " + ctx.objectif);
  if (ctx.precisions) lines.push("Précisions du dirigeant : " + String(ctx.precisions).slice(0, 4000));
  return lines.length ? lines.join("\n") : "(aucun contexte fourni)";
}

async function lecture(body) {
  const text = String(body.text || "").slice(0, MAX_TEXT);
  const blocks = fileBlocks(body.files);
  if (!text.trim() && !blocks.length) throw new Error("Aucune donnée à lire : colle un relevé ou importe un fichier.");
  const content = blocks.concat([{ type: "text", text: LECTURE_PROMPT + "\n\nContexte donné par le dirigeant :\n" + ctxText(body.context) + (blocks.length ? "\n\nLes fichiers joints (PDF ou images) font partie des données à lire." : "") + (text.trim() ? "\n\nDonnées brutes collées :\n<<<\n" + text + "\n>>>" : "") }]);
  return callClaude(content, ETAT_SCHEMA, 16000);
}

async function analyse(body) {
  const mod = String(body.module || "");
  if (!MODULE_PROMPTS[mod]) throw new Error("Module inconnu.");
  if (!body.etat || typeof body.etat !== "object") throw new Error("État financier manquant.");
  const etatJson = JSON.stringify(body.etat).slice(0, 120000);
  const raw = String(body.text || "").slice(0, RAW_EXCERPT);
  const data = "Contexte de l'entreprise :\n" + ctxText(body.context) + "\n\nÉtat financier reconstitué (JSON, validé par le dirigeant) :\n" + etatJson + (raw.trim() ? "\n\nExtrait des données brutes, pour retrouver les libellés exacts :\n<<<\n" + raw + "\n>>>" : "");
  const content = [
    { type: "text", text: data, cache_control: { type: "ephemeral" } },
    { type: "text", text: MODULE_PROMPTS[mod] }
  ];
  return callClaude(content, RAPPORT_SCHEMA, 20000);
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Daf-Bridge");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { send(res, 405, { ok: false, error: "POST uniquement" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") { send(res, 400, { ok: false, error: "Corps JSON attendu" }); return; }

  const action = String(body.action || "analyse");
  const bridged = !!BRIDGE_KEY && String(req.headers["x-daf-bridge"] || body.bridgeKey || "") === BRIDGE_KEY;
  if (!bridged) {
    const ip = String(req.headers["x-forwarded-for"] || req.socket && req.socket.remoteAddress || "?").split(",")[0].trim();
    if (rateLimited(ip)) { send(res, 429, { ok: false, error: "Trop de requêtes. Réessaie dans quelques minutes." }); return; }
  }
  try {
    if (bridged) {
      // Accès délégué à l'Academy : elle a déjà authentifié l'apprenant et compté son quota.
      if (action === "verify") { send(res, 200, { ok: true, label: String(body.label || "Academy").slice(0, 40), expires: "", quota: body.quota || { used: 0, limit: QUOTA } }); return; }
      if (action === "lecture" || action === "analyse") {
        const out = action === "lecture" ? await lecture(body) : await analyse(body);
        send(res, 200, { ok: true, action: action, module: body.module || "", result: out.data, usage: out.usage, quota: body.quota || { used: 0, limit: QUOTA } });
        return;
      }
    }
    if (action === "ping") { send(res, 200, { ok: true, model: MODEL, quota: QUOTA, configured: !!(API_KEY && SECRET && ADMIN_KEY) }); return; }

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
      send(res, 200, { ok: true, label: access.label, expires: access.expires, quota: { used: q.runs.size, limit: QUOTA } });
      return;
    }

    if (action === "lecture" || action === "analyse") {
      const runId = String(body.runId || "").slice(0, 64);
      const c = consumeRun(access.code, runId);
      if (!c.ok) { send(res, 429, { ok: false, error: "Quota du jour atteint (" + QUOTA + " analyses). Reviens demain ou contacte l'équipe Phénix.", quota: { used: c.used, limit: c.limit } }); return; }
      const out = action === "lecture" ? await lecture(body) : await analyse(body);
      send(res, 200, { ok: true, action: action, module: body.module || "", result: out.data, usage: out.usage, quota: { used: c.used, limit: c.limit } });
      return;
    }

    send(res, 400, { ok: false, error: "Action inconnue." });
  } catch (e) {
    send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};

module.exports._internal = { checkCode: checkCode, mintCode: mintCode, normTag: normTag, sign: sign, consumeRun: consumeRun, ETAT_SCHEMA: ETAT_SCHEMA, RAPPORT_SCHEMA: RAPPORT_SCHEMA, MODULE_PROMPTS: MODULE_PROMPTS, fileBlocks: fileBlocks, ctxText: ctxText };
