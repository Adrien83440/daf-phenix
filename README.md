# DAF Phénix

Ton directeur financier dopé à l'IA. Deux produits sur le même moteur, dans le même déploiement :

- **DAF Phénix** (`/`) pour les dirigeants de TPE/PME ;
- **Phénix Perso** (`/perso`) pour les particuliers, avec un espace personnel (voir [la section dédiée](#phénix-perso-particuliers)).

Site statique (Liquid Glass) + fonctions Vercel qui parlent à Claude Sonnet 5. Aucune base de données, aucune dépendance npm.

```
daf-phenix/
├── index.html      l'outil Pro (accès par code, données, lecture IA, 5 analyses, résultats, PDF, historique)
├── perso.html      l'outil Perso (accès par code, consentement, espace perso, bilan, 5 analyses, mes données)
├── admin.html      la console : tableau de bord, clients Pro et Perso, accès, activité, coût, liens et messages
├── api/daf.js      fonction serveur Pro : codes PHX, quotas, prompts, appel IA (partagé)
├── api/perso.js    fonction serveur Perso : codes PXP, quotas, prompts particuliers, cadre légal
├── api/admin.js    fonction serveur de la console (clients, accès, activité)
├── lib/store.js    stockage partagé : Vercel KV / Upstash si configuré, sinon mémoire d'instance
├── test/           tests des fonctions (node --test) et tests d'interface (jsdom)
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
   | `DAF_ADMIN_KEY` | oui | clé de secours de la console et clé des appels serveur (`mint` depuis Make) |
   | `DAF_ADMINS` | recommandé | comptes de la console, `email:hash` séparés par des virgules ; le hash vient de `npm run admin:hash -- email motdepasse` |
   | `DAF_SESSION_SECRET` | non | signe les sessions de la console (sinon `DAF_ACCESS_SECRET` est utilisé) |
   | `DAF_MODEL` | non | `claude-sonnet-5` par défaut |
   | `DAF_DAILY_QUOTA` | non | analyses par jour et par code, `10` par défaut (un audit complet = 1) |
   | `DAF_ACCESS_CODES` | non | codes fixes : `PHENIX2026:Offre lancement:2026-12-31,VIP:Client VIP` (date d'expiration facultative) |
   | `DAF_REVOKED` | non | identifiants de codes désactivés : `LECOMPTOIR,MARTIN` |
   | `DAF_ALLOW_ORIGIN` | non | origine autorisée si la page est servie depuis un autre domaine (Academy), `*` par défaut |
   | `DAF_BRIDGE_KEY` | non | clé partagée avec l'Academy : les requêtes qui la portent (en-tête `X-Daf-Bridge`) sautent le code d'accès, le quota et la limite IP, parce que l'Academy les gère elle-même |
   | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | non, recommandé | posées automatiquement quand tu rattaches une base Upstash Redis (Storage → Upstash → Redis) au projet, avec ou sans préfixe (`dafphenix_KV_REST_API_URL` fonctionne aussi) : clients, comptes, révocations, quotas et activité survivent aux redémarrages (voir [la console](#la-console-admin)) |
   | `DAF_PRICE_IN`, `DAF_PRICE_OUT` | non | tarifs en dollars par million de jetons (défaut 2 et 10) pour l'estimation de coût de la console |

4. **Redeploy** (Deployments → ⋯ → Redeploy) pour que les variables soient prises en compte.
5. **Domaine** : Settings → Domains, par exemple `daf.adrienemily.com`. Vérifie avec `https://ton-domaine/api/daf` en POST `{"action":"ping"}` ou simplement en ouvrant `/admin`.

## La console admin

`https://ton-domaine/admin`. Connexion par **e-mail et mot de passe** (session de 12 heures), ou par la clé `DAF_ADMIN_KEY` en secours.

**Créer ton compte.** En local : `npm run admin:hash -- toi@exemple.com "ton mot de passe"` affiche la ligne `DAF_ADMINS=…` à coller dans les variables Vercel, puis redéploie. Ou bien : connecte-toi une fois avec la clé, Réglages → « Créer ou réinitialiser un compte » ; avec Vercel KV le compte est conservé, sans KV la console te donne la ligne à mettre dans `DAF_ADMINS`. Les mots de passe sont hachés (scrypt), jamais stockés en clair ; mot de passe oublié : même procédure, la clé ou la variable te permettent toujours de repartir. Plusieurs comptes possibles (Réglages → « Ajouter un compte »), huit échecs de connexion bloquent l'adresse IP un quart d'heure.

Six onglets :

- **Tableau de bord** : santé (clé API, secret, stockage, région), analyses et coût du jour, des 7 et 30 derniers jours, coût moyen par analyse, erreurs IA, graphique 30 jours Pro / Perso, clients actifs et qui expirent bientôt, dernière activité.
- **Clients** : tous les accès Pro et Perso avec statut (actif, expire bientôt, expiré, révoqué, remplacé), date d'expiration, bilans du jour sur quota, analyses et appels cumulés, coût, dernier usage. Filtres par produit et statut, recherche. Un clic ouvre la fiche : nom, e-mail, note, quota personnalisé, message prêt à envoyer, **prolonger** (nouveau code, l'ancien est révoqué), **révoquer / réactiver** (effet immédiat), **supprimer**. Les codes vus dans l'activité mais jamais enregistrés (Academy, codes fixes, codes émis avant la console) apparaissent comme « non enregistrés » et peuvent être enregistrés.
- **Nouvel accès** : produit, type d'accès (compte e-mail + mot de passe provisoire, ou code), nom, durée, e-mail, quota, note → identifiants ou code, lien, message et bouton e-mail. Aussi : enregistrer un code existant, vérifier un code.
- **Activité** : un événement par appel IA (client, lecture ou module, réussite ou échec, durée, jetons, coût), filtres, et le détail jour par jour.
- **Liens et messages** : les trois adresses à fournir (`/` pour les dirigeants, `/perso` pour les particuliers, `/admin` pour toi) et quatre modèles de message (Pro / Perso × compte / code), modifiables (variables `{nom}`, `{email}`, `{motdepasse}`, `{code}`, `{lien}`, `{expiration}`, `{quota}`), gardés dans ton navigateur.
- **Réglages** : comptes de la console (changer son mot de passe, ajouter, retirer), état des variables d'environnement, listes de révocation et codes fixes, tarifs retenus, guide de branchement du stockage.

**Stockage.** Sans base, la console ne voit que ce qui s'est passé depuis le dernier démarrage de la fonction, et une révocation faite ici ne tient que jusqu'au prochain redémarrage. Pour que tout soit conservé : sur Vercel, Storage → **Upstash** → Redis (offre gratuite, région Europe), rattache la base au projet, redéploie. Les variables sont posées automatiquement (le préfixe que Vercel ajoute n'a pas d'importance), rien d'autre à installer (pas de SDK), et `lib/store.js` bascule seul. Pas « Redis, Official Redis for Vercel » : il ne fournit qu'une connexion TCP sans API REST. Les outils Pro et Perso fonctionnent dans les deux cas, et continuent de fonctionner en mémoire si KV tombe en panne.

**Codes.** `PHX-LECOMPTOIR-2709-K7QM3XZ2` (Pro) ou `PXP-MARIE-2710-…` (Perso) : identifiant, mois d'expiration (fin de mois), signature. Vérifiés par calcul : un code reste valable même si la base est vide, et un code Pro ouvre aussi l'espace Perso. Révocation : depuis la console (immédiate, conservée avec KV) ou par les variables `DAF_REVOKED` / `PERSO_REVOKED` (identifiant entre le préfixe et la date, redéploiement nécessaire). Quota par défaut `DAF_DAILY_QUOTA` / `PERSO_DAILY_QUOTA`, ou personnalisé par client depuis sa fiche.

**API de la console** (`POST /api/admin`, jeton de session `adminToken` obtenu par `login {email, password}`, ou `adminKey` dans le corps / en-tête `X-Admin-Key`) : `me`, `password`, `admins`, `admin_set`, `admin_delete`, `overview`, `clients`, `events`, `mint {product, name, months, email, note, quota, access:"account"|"code"}` (avec `access:"account"`, la réponse contient `password`, le mot de passe provisoire), `reset_password {code}`, `import {code, name, email, note}`, `update {code, name, email, note, quota}`, `extend {code, months}`, `revoke {code}`, `unrevoke {code}`, `delete {code}`, `verify {code}`. Les fonctions `/api/daf` et `/api/perso` gardent leur action `mint` (même clé) pour un scénario Make après paiement : le code émis est enregistré dans la console avec `email` et `note` s'ils sont fournis.

## Accès des utilisateurs : compte ou code

Deux façons de donner l'accès, au choix dans « Nouvel accès » :

- **Compte e-mail + mot de passe provisoire** (recommandé) : la personne reçoit son e-mail et un mot de passe provisoire lisible (`horizon-atout-4821`), se connecte, choisit son propre mot de passe, et n'entend jamais parler de code. Le code existe toujours en interne : c'est lui qui porte l'expiration, le quota et la révocation, et l'outil le garde sur l'appareil après connexion. Prolonger un accès ne change rien pour la personne (même e-mail, même mot de passe). Depuis la fiche, « Nouveau mot de passe provisoire » remplace un mot de passe oublié. Un compte Pro ouvre aussi Phénix Perso ; un compte Perso n'ouvre pas l'outil Pro. **Le stockage KV est requis** : sans lui la console ne propose que les codes.
- **Code d'accès** : comme avant, la personne saisit son code (« J'ai un code d'accès » sur l'écran de connexion). Utile sans KV, pour les scénarios Make existants, ou pour un accès sans e-mail.

Côté sécurité : mots de passe hachés (scrypt), huit échecs de connexion bloquent l'adresse IP un quart d'heure, un mot de passe provisoire doit être remplacé à la première connexion et ne peut pas être réutilisé.

## Ce que fait l'outil

1. **Données** : coller (relevé, export compta, bilan, caisse), importer (PDF, photos compressées sur l'appareil, CSV, TXT, 5 fichiers / 3,5 Mo) ou saisir un formulaire. Contexte : secteur, effectif, statut, objectif, précisions.
2. **Lecture** : l'IA reconstitue l'état financier (CA, charges, salaires, rémunération, impôts, tréso, découvert, mois par mois, dettes, récurrents, alertes, ce qui manque). Le dirigeant corrige les chiffres avant d'analyser. En mode formulaire, aucun appel IA à cette étape.
3. **Analyses** : Audit financier (score Phénix /100 sur 5 axes), Plan de croissance, Optimisation trésorerie, Fuites d'argent, Destructeur de dettes, ou Audit complet (les 5 enchaînées, 1 seule analyse décomptée).
4. **Résultats** : onglets par module, KPIs, diagnostic, fuites classées par coût annuel, opportunités, allocation, stratégie dettes avec projection avant/après, feuille de route, automatisations, plan 90 jours cochable (persisté), hypothèses et questions pour affiner, mot du DAF. Export PDF via la feuille d'impression claire. Historique des 8 dernières analyses sur l'appareil.

Les prompts (persona DAF, lecture, 5 modules) vivent uniquement dans `api/daf.js` : `SYSTEM`, `LECTURE_PROMPT`, `MODULE_PROMPTS`. Les réponses sont en JSON structuré validé par l'API (aucun risque de JSON cassé). Le préfixe (persona + état financier) est mis en cache entre les 5 appels d'un audit complet.

## Coût indicatif

Sonnet 5 : 2 $ par million de tokens en entrée, 10 $ en sortie. Un audit complet sur un relevé de 3 mois = 1 lecture + 5 analyses, de l'ordre de 0,30 à 0,80 $ selon la taille des données (les PDF et photos coûtent plus que du texte collé). Le quota journalier par code borne l'exposition.

## Limites à connaître

- **Sans Vercel KV, quotas et activité en mémoire d'instance** : protection souple (une instance qui redémarre repart de zéro). Rattache une base KV dès que tu vends en volume ou que tu veux une console fiable ; la limite par IP reste en mémoire dans tous les cas.
- **Corps de requête Vercel limité à 4,5 Mo** : d'où la limite à 3,5 Mo de fichiers. Les photos sont recompressées côté client (1 800 px, JPEG).
- **HEIC (photos iPhone)** : non lisible dans tous les navigateurs ; une capture d'écran fonctionne toujours.
- **Polices Google** (Fraunces, Inter) chargées en ligne ; repli système sinon.
- **Confidentialité** : la mention est purement informative, rien n'a changé dans le trajet des données (navigateur → fonction Vercel → API Anthropic ; sauvegarde locale sur l'appareil).

## Phénix Perso (particuliers)

La version grand public : un directeur financier personnel qui lit un relevé de compte, reconstruit le budget, chiffre les fuites, organise le cash-flow, attaque les dettes et livre un plan 90 jours. Pensée pour un abonnement à une dizaine d'euros par mois : ce que l'abonné garde, c'est **son espace**.

**L'espace perso** (écran d'accueil, `perso.html`) : score Phénix et son évolution, revenus / dépenses / reste / taux d'épargne du dernier bilan, épargne de sécurité avec cible réglable (1 à 6 mois de dépenses) et délai pour l'atteindre, objectifs d'épargne (montant, date, effort mensuel calculé, progression), abonnements repérés avec suivi des résiliations (« libéré grâce à toi : X € / mois »), dettes et stratégie, plan 90 jours avec les prochaines actions à cocher, budget mensuel issu de l'optimisation du cash-flow, courbes d'évolution sur les bilans successifs, rappel de bilan mensuel.

**Le cycle mensuel** (ce qui fait revenir l'abonné) : l'espace compte les jours du mois en cours (30 jours après le dernier bilan) et affiche les actions de la semaine (en retard, cette semaine, à venir) à cocher, un compteur de progrès (série de mois consécutifs, actions validées, argent libéré, évolution de l'épargne de sécurité et du score), un conseil de la semaine (trente conseils qui tournent, sans appel IA) et un rappel mensuel à ajouter dans l'agenda (fichier `.ics`, sans infrastructure d'e-mail). Quand le mois est écoulé, l'espace le dit et propose le **Bilan du mois** : une sixième analyse qui reçoit le bilan précédent (situation, score, plan avec ce qui a été coché et quand), chiffre les progrès avant / après, reconnaît les actions validées, relance celles en attente avec un conseil, recalcule le score, donne un défi du mois et le plan des quatre semaines qui viennent. Elle est présélectionnée avec l'audit dès qu'un bilan précédent existe.

**Phénix en direct** (Premium) : un assistant vocal plein écran. Un orbe animé sur canvas réagit au niveau réel du micro à l'écoute, respire pendant la réflexion et se module pendant la réponse. La reconnaissance et la synthèse vocales sont celles du navigateur (Chrome, Safari, iPhone ; repli en mode écrit sinon), sans serveur audio ni bibliothèque. La personne raconte ce qui se passe ; l'IA répond en deux à quatre phrases à voix haute, et si le changement est durable (travail, logement, dette, projet) elle réécrit le paragraphe de situation, l'annonce et laisse annuler ; elle peut proposer une action à ajouter à la semaine. Chaque tour est un appel court (effort bas, 1 200 jetons), compté à part des bilans (`PERSO_VOCAL_QUOTA`, 40 par jour). L'accès se donne depuis la console (case « Premium » sur la fiche ou à la création) ou pour tous avec `PERSO_VOCAL_POUR_TOUS=1`.

**Ma situation** : à la première connexion, un écran « Parle-moi de toi » demande le prénom, un paragraphe libre (amorces cliquables « Je vis… », « Je gagne… », « Ce qui me pèse… », 700 caractères) et l'objectif du moment. La situation vit ensuite dans l'espace (carte « Ma situation », bouton « Mettre à jour ») et sur l'écran Données ; chaque mise à jour est datée et les cinq versions précédentes sont gardées et transmises à l'IA, qui voit ainsi l'évolution (nouveau travail, déménagement, dette soldée…).

**Le bilan** : mêmes trois entrées que la version Pro (coller, importer, saisir) mais avec des postes de particulier (logement, énergie et télécoms, courses, transport, assurances, santé, enfants, abonnements, shopping, sorties, frais bancaires, impôts, crédits, autres) et cinq analyses : 01 Audit de ton argent (score sur 5 axes : budget, épargne, dépenses, dettes, sécurité), 02 Plan de richesse, 03 Optimisation du cash-flow, 04 Fuites d'argent, 05 Destructeur de dettes, plus 06 Bilan du mois à partir du deuxième bilan. Le bilan complet enchaîne les cinq (et le bilan du mois s'il est disponible) pour un seul bilan de quota.

**Cadre légal** (détail dans `CONFORMITE-PERSO.md`) : le persona interdit tout conseil en investissement, toute recommandation de produit, d'établissement, de crédit ou de rachat de crédits, et renvoie vers un conseiller agréé, un Point Conseil Budget ou la Banque de France. Chaque rapport porte un avertissement. Côté RGPD : rien n'est stocké côté serveur, les données vivent sur l'appareil, écran de transparence à la première connexion, page « Mes données » (inventaire, export JSON, effacement), politique de confidentialité intégrée.

**Variables d'environnement** (en plus de celles ci-dessus, qui restent partagées : clé Anthropic, secret des codes, clé admin, modèle, effort) :

| Variable | Rôle |
|---|---|
| `PERSO_DAILY_QUOTA` | bilans par jour et par code, `5` par défaut (un bilan complet = 1) |
| `PERSO_ACCESS_CODES` | codes fixes : `ESSAI:Offre essai:2026-12-31` |
| `PERSO_REVOKED` | identifiants de codes Perso désactivés : `DUPONT,MARTIN` |

**Codes** : `PXP-MARIE-2710-K7QM3XZ2`, générés depuis la console (« Nouvel accès », produit Phénix Perso) ou par `POST /api/perso` `{"action":"mint","adminKey":"…","name":"Marie","months":1,"email":"…"}`. Signés avec le même secret mais dans un espace distinct : un code Perso n'ouvre pas l'outil Pro ; un code Pro ouvre aussi l'espace Perso (bonus client entreprise). Le message prêt à envoyer pointe vers `/perso`.

**Abonnement** : rien n'est branché. Le plus simple avec l'existant : un lien de paiement Stripe en abonnement mensuel, un scénario Make qui à chaque `invoice.paid` appelle `mint` avec `months: 2` (un mois de marge) et envoie le code par ActiveCampaign ; à `customer.subscription.deleted`, ajoute l'identifiant à `PERSO_REVOKED`. L'abonné n'a jamais à ressaisir un code tant qu'il paie : la page vérifie le code à chaque ouverture et n'affiche l'écran de code que s'il est refusé.

**Personnaliser** : éditeur, contact et date de la politique de confidentialité dans `window.PERSO_CONFIG` en tête de `perso.html` (`editeur`, `contact`, `privacyDate`) ; ces trois valeurs sont à renseigner avant la mise en ligne.

**Tests** : `npm test` (fonctions Pro, Perso, console et stockage, IA et KV simulés) et `npm run test:ui` (trois parcours dans jsdom : deux sur `perso.html`, un sur la console avec les vraies fonctions ; `npm install --no-save jsdom` une fois).

## Intégration Academy

Le mode d'emploi complet pour Claude Code est dans `BRIEF-DAF-PHENIX-CLAUDE-CODE.md`. En résumé : `index.html` détecte `window.AcademyApp` (`onData` / `save` pour la sauvegarde, `ai(payload)` pour l'IA) et n'a pas besoin d'être modifié ; l'Academy expose une route `/api/daf` qui authentifie l'apprenant, compte son quota dans Firestore et relaie vers cette fonction avec l'en-tête `X-Daf-Bridge: <DAF_BRIDGE_KEY>`. Un seul cerveau (les prompts restent ici), deux portes d'entrée (codes vendus, compte Academy).

## Personnaliser

- Couleurs : bloc `:root` en tête du `<style>` de `index.html` (`--gold`, `--ember`, `--plum`, `--bg`).
- Textes : tout est dans `index.html` (écrans) et `api/daf.js` (prompts).
- Secteurs, statuts, objectifs : constantes `SECTEURS`, `STATUTS`, `OBJECTIFS` dans le premier `<script>` de `index.html`.
