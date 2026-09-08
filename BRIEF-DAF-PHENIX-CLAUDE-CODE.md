# Brief Claude Code — DAF Phénix

> À lire en entier avant de toucher au code. Le produit est **déjà construit et testé** : ton travail est de le mettre en ligne (lien à part, vendable) puis de l'intégrer dans AE Academy (accès par compte apprenant, sans code). Tu ne redéveloppes rien, tu ne redessines rien.

## 0. Ce que tu as sous la main

Dossier `daf-phenix/` (dézippé par Adrien, à placer à côté du repo `ae-academy`, par exemple `~/dev/daf-phenix`) :

```
daf-phenix/
├── index.html      l'outil complet (Liquid Glass, vanilla JS, 92 Ko, aucune dépendance)
├── admin.html      page /admin : génère un code d'accès client (action mint)
├── api/daf.js      fonction Vercel CommonJS : codes, quotas, prompts, appel Claude Sonnet 5
├── vercel.json     maxDuration 300, cleanUrls
├── package.json    minimal, zéro dépendance npm
├── README.md       mode d'emploi (déploiement, variables, coût, limites)
└── BRIEF-DAF-PHENIX-CLAUDE-CODE.md   ce fichier
```

Ce qui a déjà été validé (ne pas refaire, mais tu peux relire) : 40 assertions sur le moteur, tests de la fonction (signature des codes, expiration, révocation, quota, pont Academy, schémas de sortie, handler complet avec IA simulée), parcours Chromium de bout en bout sur mobile et bureau, page admin, feuille d'impression.

**Le produit en une phrase** : le dirigeant colle un relevé bancaire / export compta / caisse (ou importe PDF, photos, CSV, ou saisit un formulaire), l'IA reconstitue son état financier (éditable), puis lance une ou cinq analyses (Audit financier avec score Phénix /100, Plan de croissance, Optimisation trésorerie, Fuites d'argent, Destructeur de dettes) et livre un plan 90 jours cochable, exportable en PDF.

**Le cerveau est unique** : les prompts, les schémas JSON et l'appel Anthropic vivent uniquement dans `api/daf.js`. L'Academy n'en fera jamais une copie : elle relaie.

## 1. Règles de travail (non négociables)

1. **Rien ne change dans le design ni dans les prompts** sans demande explicite d'Adrien. `index.html` et `api/daf.js` sont livrés tels quels ; les seules modifications autorisées sont celles listées dans ce brief.
2. **Production sensible** : l'Academy a ~99 apprenants actifs. L'intégration doit être invisible tant que l'Outil n'est pas importé dans une formation. Aucune migration de données, aucun changement de comportement existant.
3. **Un fichier à la fois** : modifie, vérifie (`tsc`/lint du repo, test manuel), commit, puis fichier suivant. Pas de commit fourre-tout.
4. **Firestore** : toute nouvelle collection ou règle est signalée explicitement à Adrien, avec le texte exact de la règle, avant déploiement des règles.
5. **Secrets** : jamais dans le code ni dans un commit. Variables Vercel uniquement. Génère-les avec `openssl rand -hex 24` et donne-les une seule fois à Adrien pour son gestionnaire de mots de passe.
6. **Si un point de ce brief contredit ce que tu vois dans le repo** (nom d'un helper, mécanisme d'auth, forme du pont), le repo gagne : adapte-toi au mécanisme existant, n'en crée pas un parallèle. Dis-le dans ton compte rendu.
7. **Questions groupées** : pose toutes tes questions d'un coup au départ (voir §7), puis avance.

## 2. Objectif A — Le lien à part (produit vendable)

Résultat attendu : `https://daf.adrienemily.com` fonctionne avec un code d'accès, `https://daf.adrienemily.com/admin` permet à Adrien de générer des codes.

1. **Repo GitHub** (privé) `Adrien83440/daf-phenix` à partir du dossier, en conservant l'arborescence (`api/daf.js` à la racine du repo, c'est ce que Vercel attend).
   ```bash
   cd ~/dev/daf-phenix && git init && git add . && git commit -m "DAF Phénix v1"
   gh repo create Adrien83440/daf-phenix --private --source . --push
   ```
2. **Projet Vercel** `daf-phenix` (équipe d'Adrien, framework `Other`, pas de build command, output = racine). Via CLI (`vercel link` puis `vercel --prod`) ou via le dashboard « Import Git Repository ». Fluid Compute activé comme sur les autres projets.
3. **Variables d'environnement (Production)** :

   | Variable | Valeur |
   |---|---|
   | `ANTHROPIC_API_KEY` | celle d'Adrien (demander : réutiliser la clé d'Alteor ou en créer une dédiée, la dédiée est préférable pour suivre le coût) |
   | `DAF_ACCESS_SECRET` | `openssl rand -hex 24` — **ne devra plus jamais changer** (tous les codes émis en dépendent) |
   | `DAF_ADMIN_KEY` | `openssl rand -hex 16` |
   | `DAF_BRIDGE_KEY` | `openssl rand -hex 24` — la même valeur ira dans l'Academy (§3) |
   | `DAF_DAILY_QUOTA` | `10` |
   | `DAF_ALLOW_ORIGIN` | `*` pour l'instant (le mode Academy passe par le serveur, pas par le navigateur) |
   | `DAF_ACCESS_CODES` | facultatif, si Adrien veut un code fixe « offre de lancement » : `PHENIX2026:Offre lancement:2026-12-31` |

   Puis **Redeploy** (les fonctions lisent les variables au déploiement).
4. **Domaine** : `daf.adrienemily.com` (Settings → Domains, CNAME vers `cname.vercel-dns.com` chez le registrar). À confirmer avec Adrien (§7).
5. **Recette** :
   ```bash
   curl -s -X POST https://daf.adrienemily.com/api/daf -H 'content-type: application/json' -d '{"action":"ping"}'
   # attendu : {"ok":true,"model":"claude-sonnet-5","quota":10,"configured":true}
   ```
   Puis sur `/admin` : générer un code de test (client « TEST », 1 mois), l'utiliser sur `/`, coller un relevé fictif d'une vingtaine de lignes, vérifier la lecture, lancer un **Audit complet**, exporter le PDF. Note le temps total et le coût affiché dans la console Anthropic. Fournis à Adrien : URL, URL admin, les trois secrets, le code de test.

Option plus tard (ne pas faire maintenant) : automatiser la vente avec Make — après paiement, appel HTTP `POST /api/daf` `{"action":"mint","adminKey":"…","name":"<nom client>","months":12}` puis e-mail ActiveCampaign avec le code. Tout est déjà prêt côté fonction.

## 3. Objectif B — Dans l'Academy, sans code

### 3.1 Architecture cible

```
Apprenant connecté
   └─ page de leçon Academy (React, session Firebase)
        └─ iframe sandbox de l'Outil « DAF Phénix » = index.html tel quel
             └─ window.AcademyApp (pont injecté par l'Academy, existant)
                  ├─ onData(cb)   → données sauvegardées de l'apprenant (existant)
                  ├─ save(obj)    → sauvegarde (existant)
                  └─ ai(payload)  → NOUVEAU : postMessage vers la page parente
                                     └─ fetch POST /api/daf (route Academy, NOUVELLE)
                                          ├─ authentifie l'apprenant (mécanisme existant du repo)
                                          ├─ vérifie son accès, compte son quota (Firestore)
                                          └─ relaie vers https://daf.adrienemily.com/api/daf
                                             avec l'en-tête X-Daf-Bridge: <DAF_BRIDGE_KEY>
```

`index.html` gère déjà tout ça de son côté :
- s'il trouve `window.AcademyApp`, il utilise `onData`/`save` à la place du `localStorage`, et `ai(payload)` à la place du `fetch` (`window.DAF_CONFIG.endpoint` est alors ignoré) ;
- il **saute l'écran du code d'accès** dès que les données reçues par `onData` contiennent un champ `code` non vide (mets `"ACADEMY"`) ;
- il appelle `ai({action:"verify"})` au démarrage pour afficher le prénom et le quota, puis `lecture` et `analyse` ;
- en mode Academy il ne garde que les 3 dernières analyses dans l'historique (taille des documents Firestore) ;
- `onData` ne doit rappeler le callback qu'une fois par chargement (le tool ignore les rappels suivants, mais évite-les).

### 3.2 Étendre le pont `AcademyApp` avec `ai`

Repère dans `ae-academy` comment le pont est injecté dans les Outils (côté page apprenant : rendu de la leçon `isTool:true`, iframe `sandbox`, script injecté avant le contenu, écoute des `postMessage` pour `save`/`onData`). Ajoute une méthode `ai` dans le même style, sans toucher au comportement de `onData`/`save` pour les autres Outils.

Contrat côté iframe (ce que `index.html` attend) :
```js
// AcademyApp.ai(payload) → Promise<objet JSON de la réponse>
// payload : { action:"verify"|"lecture"|"analyse", code:"ACADEMY", runId, module?, etat?, context?, text?, files? }
// résolution : { ok:true, label, quota:{used,limit}, result?, module? }  ou  { ok:false, error, quota? }
// Ne jamais rejeter la promesse pour une erreur métier : résoudre avec { ok:false, error:"…" }.
```
Implémentation attendue : `ai` génère un id, poste `{ type:"academy:ai", id, payload }` à `window.parent`, et résout à la réception de `{ type:"academy:ai:result", id, result }`. Côté page parente : à la réception, `fetch("/api/daf", { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer "+idToken }, body: JSON.stringify(payload) })` puis renvoi du JSON à l'iframe (avec `{ ok:false, error:"Connexion impossible…" }` en cas d'exception). Les `files` en base64 peuvent peser jusqu'à 3,5 Mo : `postMessage` les transporte sans problème, la route Vercel aussi (limite 4,5 Mo).

Deux points concrets à vérifier sur le rendu de l'iframe :
- l'attribut `sandbox` doit contenir **`allow-modals`** en plus de `allow-scripts`, sinon Chrome bloque `window.print()` et l'export PDF ne fait rien (« Ignored call to 'print()'… ») ;
- le script du pont doit être défini **avant** les scripts de `index.html` (le tool lit `window.AcademyApp` dès son initialisation, au `DOMContentLoaded`).

### 3.3 Route Academy `app/api/daf/route.js`

Squelette à adapter au repo (App Router, runtime Node, `maxDuration` 300 : Fluid Compute est actif) :

```js
export const runtime = "nodejs";
export const maxDuration = 300;
import { NextResponse } from "next/server";
// requireLearner : reprends le mécanisme d'authentification serveur déjà utilisé par les routes protégées du repo
// (vérification du token Firebase côté serveur). Ne crée pas un second mécanisme.
// db : reprends l'accès Firestore serveur déjà utilisé par les routes du pont V11 (provisioning, set-path).

const ENDPOINT = process.env.DAF_ENDPOINT;                   // https://daf.adrienemily.com/api/daf
const BRIDGE = process.env.DAF_BRIDGE_KEY;                   // même valeur que sur le projet daf-phenix
const QUOTA = parseInt(process.env.DAF_DAILY_QUOTA || "10", 10);
const json = (o, status) => NextResponse.json(o, { status: status || 200 });

export async function POST(req) {
  const user = await requireLearner(req);                    // { uid, prenom, ... } ou null
  if (!user) return json({ ok: false, error: "Connecte-toi à l'Academy pour utiliser DAF Phénix." }, 401);
  const body = await req.json();
  const action = String(body.action || "analyse");
  if (!["verify", "lecture", "analyse"].includes(action)) return json({ ok: false, error: "Action inconnue." }, 400);
  if (!(await hasDafAccess(user))) return json({ ok: false, error: "Ton accès ne comprend pas DAF Phénix." }, 403);

  const quota = action === "verify" ? await readQuota(user.uid) : await consumeRun(user.uid, String(body.runId || "").slice(0, 64));
  if (!quota.ok) return json({ ok: false, error: `Quota du jour atteint (${QUOTA} analyses). Reviens demain.`, quota }, 429);
  if (action === "verify") return json({ ok: true, label: user.prenom || "Toi", expires: "", quota });

  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-daf-bridge": BRIDGE },
    body: JSON.stringify({ ...body, label: user.prenom || "", quota })
  });
  const out = await r.json().catch(() => ({ ok: false, error: "Réponse illisible du DAF." }));
  return json(out, r.status);
}
```

Règles métier :
- `hasDafAccess(user)` : l'apprenant a accès si une formation à laquelle il a droit contient l'Outil DAF Phénix (même logique que l'accès aux contenus, cf. sélecteurs de formation V11b). Si c'est plus simple dans le repo, un flag booléen `daf: true` sur son document d'accès, posé par Adrien depuis le back-office, fait l'affaire. Choisis l'option la plus proche de l'existant et dis laquelle.
- **Quota** : `DAF_DAILY_QUOTA` analyses par apprenant et par jour ; un **audit complet compte pour 1** parce que le tool envoie le même `runId` pour la lecture et les cinq analyses d'une même session. `consumeRun` = transaction Firestore sur `dafUsage/{uid}` : `{ day: "AAAA-MM-JJ", runs: ["RUNID", …] }` ; si `day` ≠ aujourd'hui → réinitialise ; si `runId` déjà présent → ok sans compter ; sinon si `runs.length >= QUOTA` → refus ; sinon ajoute. Retourne `{ ok, used: runs.length, limit: QUOTA }`.
- La fonction distante, quand elle reçoit `X-Daf-Bridge`, **ne vérifie ni code ni quota ni limite d'IP** : c'est la route Academy qui est responsable des trois. Elle renvoie tel quel le `quota` transmis, pour l'affichage.

Variables Vercel à ajouter sur le projet **Academy** : `DAF_ENDPOINT`, `DAF_BRIDGE_KEY`, `DAF_DAILY_QUOTA`.

### 3.4 Sauvegarde des données du tool

`index.html` sauvegarde via `AcademyApp.save(obj)` un objet `{ v, code, label, mode, text (≤ 150 000 caractères), form, ctx, checks, history (≤ 3 analyses) }` qui peut atteindre quelques centaines de Ko. **Ne le range pas dans le document de progression** (`progress[courseId].appData[lessonId]`, limite Firestore 1 Mo partagée avec tout le reste). Pour cet Outil, fais pointer `save`/`onData` vers un document dédié `dafData/{uid}` (ou `users/{uid}/apps/daf`, au choix selon les conventions du repo), avec un `updatedAt`. Si le pont actuel ne permet pas de cibler un autre document par Outil, ajoute une option au niveau de la leçon (`storage:"dedicated"`) plutôt qu'un cas particulier codé en dur.

**Règles Firestore à ajouter** (à signaler à Adrien avant déploiement) :
```
match /dafUsage/{uid} { allow read: if request.auth != null && request.auth.uid == uid; allow write: if false; }   // écrit uniquement par le serveur
match /dafData/{uid}  { allow read, write: if request.auth != null && request.auth.uid == uid; }                    // ou serveur seul si le pont écrit côté serveur
```

### 3.5 Importer l'Outil

1. Dans le builder, la leçon Outil « DAF Phénix » (kind `sub` / `isTool:true`) reçoit `index.html` tel quel via l'import HTML artisanal. Vérifie que l'import conserve le `<head>` (polices Google, `<style>`, le script `window.DAF_CONFIG`) et ne réécrit pas les `<script>`.
2. Taille : `index.html` fait 94 574 octets, sous le plafond `APP_MAX_BYTES` (100 Ko). Si le plafond est appliqué **après** injection du pont et qu'il déborde, monte `APP_MAX_BYTES` à 128 Ko : c'est une constante, pas une règle métier.
3. Place l'Outil dans la ou les formations désignées par Adrien (§7). Une seule copie du HTML dans Firestore ; s'il faut le même Outil dans plusieurs formations, demande si le système supporte une référence partagée, sinon importe-le deux fois et note-le dans le compte rendu (une mise à jour = deux imports).
4. Mode Bâtiment : rien à faire, l'Outil est une leçon comme une autre (une pièce).
5. Optionnel si Adrien le souhaite : une carte « DAF Phénix » dans l'espace apprenant qui ouvre directement la leçon Outil. Pas de page dédiée à créer.

## 4. Contrats exacts (référence)

Requêtes (JSON, POST) — identiques en standalone et via le pont :

| action | corps | réponse |
|---|---|---|
| `verify` | `{ code }` | `{ ok, label, expires, quota:{used,limit} }` |
| `lecture` | `{ code, runId, text, files:[{name,type,data(base64)}], context }` | `{ ok, result: <état financier>, quota, usage }` |
| `analyse` | `{ code, runId, module:"audit"\|"plan"\|"treso"\|"fuites"\|"dettes", etat, context, text }` | `{ ok, module, result: <rapport>, quota, usage }` |
| `mint` (admin, standalone seulement) | `{ adminKey, name, months }` | `{ ok, code, label, expires }` |
| `ping` | `{}` | `{ ok, model, quota, configured }` |

Erreurs : `{ ok:false, error:"message en français prêt à afficher" }` avec le statut HTTP correspondant (401 code refusé, 403 accès, 429 quota ou trop de requêtes, 500 IA).

Formes de `result` : voir `ETAT_SCHEMA` et `RAPPORT_SCHEMA` dans `api/daf.js` (toutes les propriétés sont présentes, sections vides = `[]`, `""` ou `0`).

## 5. Checklist de fin (Definition of Done)

Standalone
- [ ] `ping` renvoie `configured:true` sur le domaine final
- [ ] code généré sur `/admin`, accepté sur `/`, refusé après modification d'un caractère
- [ ] audit complet réel sur un relevé fictif : 5 onglets, score affiché, PDF exporté, historique rechargé après refresh
- [ ] secrets transmis à Adrien, aucun dans git

Academy
- [ ] apprenant sans accès DAF : 403 propre, l'Outil affiche l'erreur (pas d'écran blanc)
- [ ] apprenant avec accès : pas d'écran « code », prénom affiché en haut à droite, quota `x sur 10`
- [ ] lecture + audit complet depuis l'Outil, compté **1** dans `dafUsage/{uid}`
- [ ] 11e session du jour refusée avec le message quota
- [ ] données du tool retrouvées après rechargement (document dédié, pas le doc de progression)
- [ ] export PDF fonctionne dans l'iframe (`allow-modals`)
- [ ] aucun changement de comportement pour les autres Outils ni pour les apprenants sans l'Outil
- [ ] règles Firestore ajoutées, signalées, déployées
- [ ] `tsc`/lint du repo au vert, commits atomiques

## 6. À ne pas faire

- Recopier les prompts ou l'appel Anthropic dans l'Academy (un seul cerveau : `daf-phenix/api/daf.js`).
- Modifier `index.html` pour l'Academy : tout passe par le pont.
- Retirer le code d'accès du standalone ou assouplir `checkCode`.
- Créer une page Academy « à part » avec une iframe vers `daf.adrienemily.com` : l'apprenant aurait besoin d'un code, et on perdrait la sauvegarde par compte.
- Mettre des secrets dans `window.DAF_CONFIG` ou dans le HTML de l'Outil.
- Toucher aux règles Firestore existantes au-delà des deux ajouts ci-dessus.

## 7. Questions à poser à Adrien avant de commencer (en une seule fois)

1. Domaine du produit à part : `daf.adrienemily.com` ou autre ?
2. Clé Anthropic : réutiliser celle d'Alteor ou en créer une dédiée (recommandé pour suivre le coût du produit) ?
3. Dans quelle(s) formation(s) importer l'Outil, et à quel endroit (fin d'acte, module « Outils ») ?
4. Accès Academy : par formation (tous les inscrits de ces formations) ou par flag individuel posé depuis le back-office ?
5. Quota apprenant : 10 sessions par jour comme le standalone, ou moins ?
6. Un code fixe « offre de lancement » dès maintenant (`DAF_ACCESS_CODES`) ?

Compte rendu attendu à la fin : ce qui a été déployé (URLs), ce qui a été modifié dans `ae-academy` (fichiers, commits), les règles Firestore ajoutées, les écarts par rapport à ce brief et pourquoi, le coût mesuré d'un audit complet.
