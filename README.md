# DAF Phénix

Ton directeur financier dopé à l'IA, pour dirigeants de TPE/PME. Produit autonome : un site statique (Liquid Glass) + une fonction Vercel qui parle à Claude Sonnet 5. Aucune base de données, aucune dépendance npm.

```
daf-phenix/
├── index.html      l'outil (accès par code, données, lecture IA, 5 analyses, résultats, PDF, historique)
├── admin.html      ta page pour débloquer un client (génère un code d'accès)
├── api/daf.js      la fonction serveur : codes, quotas, prompts, appel IA
├── vercel.json     durée max 300 s, URLs propres (/admin)
├── package.json    minimal
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

## Intégration Academy

Le mode d'emploi complet pour Claude Code est dans `BRIEF-DAF-PHENIX-CLAUDE-CODE.md`. En résumé : `index.html` détecte `window.AcademyApp` (`onData` / `save` pour la sauvegarde, `ai(payload)` pour l'IA) et n'a pas besoin d'être modifié ; l'Academy expose une route `/api/daf` qui authentifie l'apprenant, compte son quota dans Firestore et relaie vers cette fonction avec l'en-tête `X-Daf-Bridge: <DAF_BRIDGE_KEY>`. Un seul cerveau (les prompts restent ici), deux portes d'entrée (codes vendus, compte Academy).

## Personnaliser

- Couleurs : bloc `:root` en tête du `<style>` de `index.html` (`--gold`, `--ember`, `--plum`, `--bg`).
- Textes : tout est dans `index.html` (écrans) et `api/daf.js` (prompts).
- Secteurs, statuts, objectifs : constantes `SECTEURS`, `STATUTS`, `OBJECTIFS` dans le premier `<script>` de `index.html`.
