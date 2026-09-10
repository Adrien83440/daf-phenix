# Phénix Perso — conformité (RGPD et cadre réglementaire)

Ce document décrit ce que le produit particuliers fait pour rester dans les règles, ce qui est déjà en place dans le code, et ce qui reste à faire avant la mise en vente. Il ne remplace pas l'avis d'un juriste : c'est la base de travail à lui donner.

## 1. Positionnement : un outil d'aide à la gestion de budget

Phénix Perso est un **outil d'aide à la gestion de budget**, pas un conseiller. Trois activités réglementées sont volontairement hors périmètre :

| Activité réglementée | Ce que ce serait | Ce que fait Phénix Perso à la place |
|---|---|---|
| Conseil en investissements financiers (CIF, statut ORIAS, contrôle AMF) | recommander un placement, un titre, un fonds, une crypto, une assurance-vie, un bien immobilier, donner une prévision de rendement | ne recommande rien de tout cela ; parle d'« épargne de sécurité sur un livret sans risque » de façon générique ; renvoie vers un conseiller agréé quand la personne veut investir |
| Intermédiation en opérations de banque (IOBSP) | conseiller de souscrire un crédit, un rachat ou un regroupement de crédits, orienter vers un organisme | explique les mécanismes (ordre de remboursement, remboursement anticipé, renégociation) et renvoie vers sa banque, un Point Conseil Budget, la Banque de France |
| Conseil fiscal ou juridique personnalisé | optimiser une situation fiscale, interpréter un contrat | orientation générale au plus, renvoi vers impots.gouv.fr, France services, un professionnel |

### Où c'est appliqué dans le code

- **Persona** (`api/perso.js`, constante `SYSTEM`, règles 1 à 4) : interdictions explicites, liste des interlocuteurs de renvoi, obligation de signaler un danger (découvert chronique, crédits renouvelables, mensualités au-delà d'un tiers des revenus) et d'orienter vers l'aide gratuite.
- **Modules** : le « Plan de richesse » rappelle l'interdiction de recommander un placement et limite l'étape « investir » au montant disponible et au renvoi vers un conseiller ; le « Destructeur de dettes » interdit rachat, regroupement, nouveau crédit, organisme ou courtier, et impose la mention du Point Conseil Budget et de la procédure de surendettement quand les seuils sont franchis.
- **Interface** (`perso.html`) : écran de transparence avant la première utilisation (« ce n'est pas un conseil en investissement »), avertissement sous chaque résultat (imprimé dans le PDF), pied de page permanent, section dédiée dans la politique de confidentialité.
- **Tests** : `test/perso.test.js` vérifie que ces règles sont présentes dans les prompts.

### Risque résiduel

Un modèle de langage peut déraper malgré les consignes. Deux garde-fous à mettre en place côté exploitation :
1. relire un échantillon de rapports chaque mois (le coût d'un bilan est de l'ordre de 0,30 à 0,80 $, en faire dix de test est bon marché) ;
2. si un dérapage est constaté, ajouter un filtre serveur simple dans `analyse()` (liste de termes : noms de banques, de courtiers, de crypto-actifs, « assurance-vie », « PEA », « SCPI »…) qui renvoie le rapport en erreur plutôt que de l'afficher. Non implémenté aujourd'hui : à décider selon ce que les premiers rapports montrent.

## 2. RGPD

### Rôles

- **Responsable de traitement** : l'éditeur du service (à renseigner dans `window.PERSO_CONFIG.editeur` et dans les mentions légales).
- **Sous-traitants** : Vercel (hébergement du site et exécution de la fonction, région `cdg1` Paris fixée dans `vercel.json`) ; Anthropic (traitement par l'IA, États-Unis).

### Données et finalités

| Données | Finalité | Base légale | Durée |
|---|---|---|---|
| Données financières fournies (relevés, exports, captures, budget saisi) et contexte (prénom, foyer, logement, situation pro, tranche d'âge, objectif, précisions) | produire la lecture et les analyses | exécution du contrat | aucune conservation serveur ; sur l'appareil jusqu'à effacement par l'utilisateur |
| Code d'accès (contient un identifiant dérivé du nom donné à l'abonnement) | vérifier l'abonnement, compter les bilans du jour | exécution du contrat, intérêt légitime (anti-abus) | compteur en mémoire d'instance, remis à zéro chaque jour |
| Adresse IP | limiter le nombre de requêtes | intérêt légitime (sécurité) | 10 minutes en mémoire d'instance |

Ce que le code garantit : aucune base de données, aucun fichier, aucune journalisation des contenus (`api/perso.js` ne fait aucun `console.log` des corps de requête ; les erreurs renvoyées ne contiennent pas les données). `Cache-Control: no-store` sur toutes les réponses. Les rapports, l'historique, les objectifs et les réglages vivent dans le `localStorage` du navigateur (clé `phenix.perso.v1`).

À savoir : Vercel conserve des journaux techniques de requêtes (horodatage, chemin, statut, IP) pendant une courte durée selon l'offre ; ils ne contiennent pas le corps des requêtes. À mentionner dans le registre.

### Transfert hors UE

Anthropic traite les données aux États-Unis. Encadrement à mettre en place : signer le **Data Processing Addendum** d'Anthropic (il intègre les clauses contractuelles types de la Commission européenne) et, si l'offre le permet, demander l'option de **non-conservation** (zero data retention) sur la clé API utilisée pour Phénix Perso. Anthropic n'entraîne pas ses modèles sur les données transmises par l'API. La politique de confidentialité intégrée à `perso.html` décrit ce transfert ; elle doit rester exacte si le fournisseur d'IA ou la région changent.

### Droits des personnes

Comme les données personnelles vivent sur l'appareil, les droits s'exercent directement dans l'outil, écran « Mes données » :
- **accès et portabilité** : inventaire de ce qui est stocké, export JSON lisible ;
- **rectification** : les chiffres se corrigent à l'écran « Lecture » avant chaque analyse ;
- **effacement** : « Tout effacer sur cet appareil » (confirmation, suppression, rechargement) ;
- **information** : écran de transparence à la première connexion (horodaté dans `consentAt`), politique de confidentialité accessible depuis trois endroits, adresse de contact affichée.

Il reste à tenir une **adresse de contact** qui répond aux demandes (dans `window.PERSO_CONFIG.contact`), et à répondre sous un mois.

### Minimisation

La lecture invite l'utilisateur à retirer nom et IBAN avant de coller ; le prompt de lecture interdit de recopier un IBAN ; le prénom est limité à 40 caractères et sert uniquement à s'adresser à la personne. Rien n'empêche l'utilisateur de coller des lignes sensibles (santé, religion, syndicat…) présentes dans un relevé : la politique le signale et propose de les retirer. Ce point plaide pour l'option de non-conservation côté Anthropic.

### Cookies et traceurs

Aucun cookie, aucun traceur, aucune mesure d'audience. Le `localStorage` est strictement nécessaire au service demandé (exempté de consentement au sens de la doctrine CNIL). Les polices Google Fonts sont chargées depuis les serveurs de Google : c'est un appel tiers qui transmet l'IP. Pour être irréprochable, héberger les deux polices (Fraunces, Inter) sur le domaine, ou accepter le repli système : à décider avant la mise en ligne.

### Analyse d'impact (AIPD)

Traitement de données financières de particuliers par une IA, à grande échelle si le produit marche : une AIPD est **recommandée** (elle sera courte : pas de stockage, pas de profilage à des fins de décision automatisée, pas de croisement). Le présent document en est la matière première.

## 3. Vente aux consommateurs (abonnement)

Avant d'encaisser le premier abonnement à 10 € par mois, il faut :

- [ ] **Mentions légales** : raison sociale, adresse, SIREN, directeur de publication, hébergeur (Vercel Inc.), contact.
- [ ] **CGV / CGU** : description du service (outil d'aide à la gestion de budget, généré par IA, sans garantie de résultat), prix TTC, durée et reconduction, résiliation en ligne aussi simple que la souscription (obligatoire depuis 2023), droit de rétractation de 14 jours pour un service numérique avec case de renonciation expresse si l'accès est immédiat, réserve aux personnes majeures.
- [ ] **Médiateur de la consommation** : obligatoire pour tout professionnel vendant à des consommateurs ; nom et coordonnées dans les CGV et sur le site.
- [ ] **Politique de confidentialité** : celle intégrée à `perso.html` est un projet complet ; la faire valider, renseigner éditeur, contact et date (`window.PERSO_CONFIG`), et la reproduire sur une page publique si le produit a un site vitrine.
- [ ] **Contrats sous-traitants** : DPA Anthropic (avec option de non-conservation), DPA Vercel (inclus dans leurs conditions, à archiver).
- [ ] **Registre des traitements** : une fiche « Phénix Perso » reprenant le tableau ci-dessus.
- [ ] **AIPD** courte (voir plus haut).
- [ ] **Assurance RC professionnelle** couvrant l'édition de logiciel et le conseil non réglementé.
- [ ] **Recette** : un bilan réel sur un relevé personnel, relecture des cinq rapports à la lumière de la section 1.
- [ ] **Polices** : trancher la question Google Fonts (section 2).

## 4. Ce que dit l'outil à l'utilisateur, mot pour mot

Les formulations juridiques visibles sont dans `perso.html` : écran « Avant de commencer » (`#s-consent`), avertissement des résultats (`#s-result .disc`), pied de page (`.foot`), écran « Mes données » (`#s-rgpd .legal`) et politique de confidentialité (`#modal-priv`). Toute modification de fond doit garder les trois messages : pas de conseil en investissement, données sur l'appareil, IA faillible.
