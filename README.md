# DAF Phénix

Ton directeur financier dopé à l'IA. Deux produits sur le même moteur, dans le même déploiement :

- **DAF Phénix** (`/`) pour les dirigeants de TPE/PME ;
- **Phénix Perso** (`/perso`) pour les particuliers, avec un espace personnel (voir [la section dédiée](#phénix-perso-particuliers)).

Site statique (Liquid Glass) + fonctions Vercel qui parlent à Claude Sonnet 5. Aucune base de données, aucune dépendance npm.

```
daf-phenix/
├── index.html      l'outil Pro (accès par code, données, lecture IA, 5 analyses, résultats, PDF, historique)
├── perso.html      l'outil Perso (accès par code, consentement, espace perso, bilan, 5 analyses, mes données)
├── admin.html      ta page pour débloquer un client Pro ou un abonné Perso (génère un code d'accès)
├── api/daf.js      fonction serveur Pro : codes PHX, quotas, prompts, appel IA (partagé)
├── api/perso.js    fonction serveur Perso : codes PXP, quotas, prompts particuliers, cadre légal
├── test/           tests de la fonction Perso (node --test) et tests d'interface (jsdom)
├── vercel.json     durée max 300 s, région Paris, URLs propres (/admin, /perso)
├── package.json    minimal
├── CONFORMITE-PERSO.md   RGPD et cadre réglementaire du produit particuliers
└── README.md
```

## Déployer en 5 étapes

1. **GitHub** : crée un dépôt `daf-phenix` et ajoute les 5 fichiers en respectant le chemin `api/daf.js` (sur GitHub : « Add file » → nom `api/daf.js`, le dossier se crée tout seul).
2. **Vercel** : « Add New… → Project » → importe `daf-phenix` → Framework `Other` → Deploy (le premier déploiement tourne, mais l'outil refusera tout code tant que les variables ne sont pas posées).
3. **Variables d'environnement** (Settings → Environment Variables, environnement Production) :

   | Variable | Obligatoire | Rôle |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | oui | ta clé API Anthropic |
   | `DAF_ACCESS_SECRET` | oui | secret qui signe les codes clients. 30 caractères au hasard, à ne jamais changer ensuite (sinon tous les codes émis meurent) |
   | `DAF_ADMIN_KEY` | oui | mot de passe de `/admin` |
   | `DAF_MODEL` | non | `claude-sonnet-5` par défaut |
   | `DAF_DAILY_QUOTA` | non | analyses par jour et par code, `10` par défaut (un audit complet = 1) |
   | `DAF_ACCESS_CODES` | non | codes fixes : `PHENIX2026:Offre lancement:2026-12-31,VIP:Client VIP` (date d'expiration facultative) |
   | `DAF_REVOKED` | non | identifiants de codes désactivés : `LECOMPTOIR,MARTIN` |
   | `DAF_ALLOW_ORIGIN` | non | origine autorisée si la page est servie depuis un autre domaine (Academy), `*` par défaut |
   | `DAF_BRIDGE_KEY` | non | clé partagée avec l'Academy : les requêtes qui la portent (en-tête `X-Daf-Bridge`) sautent le code d'accès, le quota et la limite IP, parce que l'Academy les gère elle-même |

4. **Redeploy** (Deployments → ⋯ → Redeploy) pour que les variables soient prises en compte.
5. **Domaine** : Settings → Domains, par exemple `daf.adrienemily.com`. Vérifie avec `https://ton-domaine/api/daf` en POST `{"action":"ping"}` ou simplement en ouvrant `/admin`.

## Débloquer un client

1. Ouvre `https://ton-domaine/admin`, entre la clé admin.
2. Nom du client + durée (1 à 24 mois) → **Générer le code**.
3. Copie le message prêt à envoyer (lien + code). Le client entre le code une seule fois, il reste enregistré sur son appareil.

Le code a la forme `PHX-LECOMPTOIR-2709-K7QM3XZ2` : identifiant client, mois d'expiration (fin de mois), signature. Il est vérifié par calcul, sans base : rien à stocker, rien à synchroniser. Pour couper un accès avant terme, ajoute l'identifiant à `DAF_REVOKED` et redéploie.

## Ce que fait l'outil

1. **Données** : coller (relevé, export compta, bilan, caisse), importer (PDF, photos compressées sur l'appareil, CSV, TXT, 5 fichiers / 3,5 Mo) ou saisir un formulaire. Contexte : secteur, effectif, statut, objectif, précisions.
2. **Lecture** : l'IA reconstitue l'état financier (CA, charges, salaires, rémunération, impôts, tréso, découvert, mois par mois, dettes, récurrents, alertes, ce qui manque). Le dirigeant corrige les chiffres avant d'analyser. En mode formulaire, aucun appel IA à cette étape.
3. **Analyses** : Audit financier (score Phénix /100 sur 5 axes), Plan de croissance, Optimisation trésorerie, Fuites d'argent, Destructeur de dettes, ou Audit complet (les 5 enchaînées, 1 seule analyse décomptée).
4. **Résultats** : onglets par module, KPIs, diagnostic, fuites classées par coût annuel, opportunités, allocation, stratégie dettes avec projection avant/après, feuille de route, automatisations, plan 90 jours cochable (persisté), hypothèses et questions pour affiner, mot du DAF. Export PDF via la feuille d'impression claire. Historique des 8 dernières analyses sur l'appareil.

Les prompts (persona DAF, lecture, 5 modules) vivent uniquement dans `api/daf.js` : `SYSTEM`, `LECTURE_PROMPT`, `MODULE_PROMPTS`. Les réponses sont en JSON structuré validé par l'API (aucun risque de JSON cassé). Le préfixe (persona + état financier) est mis en cache entre les 5 appels d'un audit complet.

## Coût indicatif

Sonnet 5 : 2 $ par million de tokens en entrée, 10 $ en sortie. Un audit complet sur un relevé de 3 mois = 1 lecture + 5 analyses, de l'ordre de 0,30 à 0,80 $ selon la taille des données (les PDF et photos coûtent plus que du texte collé). Le quota journalier par code borne l'exposition.

## Limites à connaître

- **Quota et anti-abus en mémoire d'instance** : protection souple (une instance Vercel qui redémarre repart de zéro). Suffisant pour un produit vendu à l'unité ; passer par une base si tu vends en volume.
- **Corps de requête Vercel limité à 4,5 Mo** : d'où la limite à 3,5 Mo de fichiers. Les photos sont recompressées côté client (1 800 px, JPEG).
- **HEIC (photos iPhone)** : non lisible dans tous les navigateurs ; une capture d'écran fonctionne toujours.
- **Polices Google** (Fraunces, Inter) chargées en ligne ; repli système sinon.
- **Confidentialité** : la mention est purement informative, rien n'a changé dans le trajet des données (navigateur → fonction Vercel → API Anthropic ; sauvegarde locale sur l'appareil).

## Phénix Perso (particuliers)

La version grand public : un directeur financier personnel qui lit un relevé de compte, reconstruit le budget, chiffre les fuites, organise le cash-flow, attaque les dettes et livre un plan 90 jours. Pensée pour un abonnement à une dizaine d'euros par mois : ce que l'abonné garde, c'est **son espace**.

**L'espace perso** (écran d'accueil, `perso.html`) : score Phénix et son évolution, revenus / dépenses / reste / taux d'épargne du dernier bilan, épargne de sécurité avec cible réglable (1 à 6 mois de dépenses) et délai pour l'atteindre, objectifs d'épargne (montant, date, effort mensuel calculé, progression), abonnements repérés avec suivi des résiliations (« libéré grâce à toi : X € / mois »), dettes et stratégie, plan 90 jours avec les prochaines actions à cocher, budget mensuel issu de l'optimisation du cash-flow, courbes d'évolution sur les bilans successifs, rappel de bilan mensuel.

**Le bilan** : mêmes trois entrées que la version Pro (coller, importer, saisir) mais avec des postes de particulier (logement, énergie et télécoms, courses, transport, assurances, santé, enfants, abonnements, shopping, sorties, frais bancaires, impôts, crédits, autres), un contexte simple (prénom, foyer, logement, situation pro, tranche d'âge, objectif) et cinq analyses : 01 Audit de ton argent (score sur 5 axes : budget, épargne, dépenses, dettes, sécurité), 02 Plan de richesse, 03 Optimisation du cash-flow, 04 Fuites d'argent, 05 Destructeur de dettes. Le bilan complet enchaîne les cinq pour un seul bilan de quota.

**Cadre légal** (détail dans `CONFORMITE-PERSO.md`) : le persona interdit tout conseil en investissement, toute recommandation de produit, d'établissement, de crédit ou de rachat de crédits, et renvoie vers un conseiller agréé, un Point Conseil Budget ou la Banque de France. Chaque rapport porte un avertissement. Côté RGPD : rien n'est stocké côté serveur, les données vivent sur l'appareil, écran de transparence à la première connexion, page « Mes données » (inventaire, export JSON, effacement), politique de confidentialité intégrée.

**Variables d'environnement** (en plus de celles ci-dessus, qui restent partagées : clé Anthropic, secret des codes, clé admin, modèle, effort) :

| Variable | Rôle |
|---|---|
| `PERSO_DAILY_QUOTA` | bilans par jour et par code, `5` par défaut (un bilan complet = 1) |
| `PERSO_ACCESS_CODES` | codes fixes : `ESSAI:Offre essai:2026-12-31` |
| `PERSO_REVOKED` | identifiants de codes Perso désactivés : `DUPONT,MARTIN` |

**Codes** : `PXP-MARIE-2710-K7QM3XZ2`, générés depuis `/admin` (choisir « Phénix Perso ») ou par `POST /api/perso` `{"action":"mint","adminKey":"…","name":"Marie","months":1}`. Signés avec le même secret mais dans un espace distinct : un code Perso n'ouvre pas l'outil Pro ; un code Pro ouvre aussi l'espace Perso (bonus client entreprise). Le message prêt à envoyer pointe vers `/perso`.

**Abonnement** : rien n'est branché. Le plus simple avec l'existant : un lien de paiement Stripe en abonnement mensuel, un scénario Make qui à chaque `invoice.paid` appelle `mint` avec `months: 2` (un mois de marge) et envoie le code par ActiveCampaign ; à `customer.subscription.deleted`, ajoute l'identifiant à `PERSO_REVOKED`. L'abonné n'a jamais à ressaisir un code tant qu'il paie : la page vérifie le code à chaque ouverture et n'affiche l'écran de code que s'il est refusé.

**Personnaliser** : éditeur, contact et date de la politique de confidentialité dans `window.PERSO_CONFIG` en tête de `perso.html` (`editeur`, `contact`, `privacyDate`) ; ces trois valeurs sont à renseigner avant la mise en ligne.

**Tests** : `npm test` (fonction serveur, IA simulée) et `npm run test:ui` (deux parcours complets de `perso.html` dans jsdom : `npm install --no-save jsdom` une fois).

## Intégration Academy

Le mode d'emploi complet pour Claude Code est dans `BRIEF-DAF-PHENIX-CLAUDE-CODE.md`. En résumé : `index.html` détecte `window.AcademyApp` (`onData` / `save` pour la sauvegarde, `ai(payload)` pour l'IA) et n'a pas besoin d'être modifié ; l'Academy expose une route `/api/daf` qui authentifie l'apprenant, compte son quota dans Firestore et relaie vers cette fonction avec l'en-tête `X-Daf-Bridge: <DAF_BRIDGE_KEY>`. Un seul cerveau (les prompts restent ici), deux portes d'entrée (codes vendus, compte Academy).

## Personnaliser

- Couleurs : bloc `:root` en tête du `<style>` de `index.html` (`--gold`, `--ember`, `--plum`, `--bg`).
- Textes : tout est dans `index.html` (écrans) et `api/daf.js` (prompts).
- Secteurs, statuts, objectifs : constantes `SECTEURS`, `STATUTS`, `OBJECTIFS` dans le premier `<script>` de `index.html`.
