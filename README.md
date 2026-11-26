# Om Holistic — Tableau de bord financier

Prévisionnel des applications Om Holistic (CHRYSALISS d'abord, puis Bujo et Doodle Studio).
Application statique, sans serveur : ouvrir `index.html`, ou activer GitHub Pages sur `main` / racine.
Pensée pour le téléphone d'abord (onglets en bas), puis l'iPad et l'ordinateur (barre latérale).

Ce sont des hypothèses de simulation, pas des données observées. Les paramètres restent dans le
navigateur : exporter régulièrement le fichier JSON depuis la page Réglages.

## Pages

- **Vue d'ensemble** : CA de la période, part programmes / abonnements, résultat, graphique mensuel, revenus par produit.
- **Résultat** : compte d'exploitation par produit (abonnement, chaque programme, commun) ou par application en vue consolidée.
- **Prévisionnel** : résultat de la période, un bloc par trimestre avec une carte par mois (CA programmes / abonnements, charges, résultat, clientes), tableau détaillé, revenus par produit (liens vers les fiches), puis la capacité de coaching en graphique (pic de clientes en même temps face à la capacité prévue, mois dépassés en rouge).
- **Charges** : charges de chaque application et charges de structure Om Holistic.
- **Produits et prix** : calendrier de l'application (lecture seule, chaque date mène à son réglage), abonnement seul (prix, essai, objectif d'abonnées, passerelles), programmes (cohortes, lancement, durée, prix, rythme d'inscriptions, promotions) et capacité de coaching.
- **Réglages** : nom de l'application, TVA, sauvegarde (export / import), ajout d'une application, retour aux exemples.

Applications par défaut : CHRYSALISS, Bujo et Doodle Studio (abonnement mensuel à 9,90 €, avec une phase « Lancement » à ajuster).

## Calendrier

Chaque programme a ses **cohortes de test** (alpha, deuxième, troisième…, autant que voulu : nom, mois, nombre de clientes),
puis une date de **lancement commercial** à partir de laquelle les inscriptions arrivent en continu.
Les prévisions commencent automatiquement à la première date (cohorte, lancement ou ouverture de l'abonnement).
La **capacité de coaching** monte en puissance par paliers : à partir de tel mois, tant de clientes en même temps
et tant d'heures par semaine.

## Passerelles et période d'essai

- Chaque programme fixe le **% de clientes qui gardent l'abonnement seul** (ex. CHRYSALISS seul) à la fin du programme,
  et le **% des abonnées qui achètent ce programme chaque mois**. Ces dernières gardent leur abonnement, occupent une
  place de coaching et ne sont pas recomptées à la fin du programme.
- L'abonnement seul peut avoir une **période d'essai** gratuite (en jours) et un % d'essais qui deviennent payants.

## Objectif d'abonnées

Dans la carte de l'abonnement seul, le bloc « Objectif d'abonnées » se règle par paliers (par défaut 100 abonnées
à 6 mois, 300 à 1 an, 1 000 à 2 ans, comptés depuis l'ouverture), en abonnées en même temps ou en nouvelles par an.
Pour chaque palier, l'outil cherche par simulation le plus petit rythme hebdomadaire qui l'atteint (résiliations et
essai gratuit compris), le compare au plan actuel, et peut l'appliquer comme paliers du rythme d'abonnements.

Chaque programme a aussi un bloc « Objectif d'inscriptions » par paliers (inscriptions par an, X mois après le lancement).
Il donne le rythme hebdomadaire nécessaire (les abonnées qui achètent le programme comptent dedans), le nombre de clientes
en même temps (rythme × durée) et les heures de coaching, et signale si la capacité prévue ne suffit pas.

## Prix en trois phases

Chaque produit (programme, abonnement direct, abonnement après programme) a trois phases de prix,
chacune avec un nom, un mois de début et un prix. Le prix appliqué est celui de la dernière phase
commencée ; avant la première date, la première phase s'applique ; une phase sans date est ignorée.
Pour un programme, le prix est le **prix total**, payé à l'inscription. Pour les abonnements, une option
permet aux abonnées de garder le prix de la phase où elles se sont abonnées.

Les anciennes sauvegardes sont converties automatiquement : tarif bêta → phase 1,
tarif de lancement → phase 2, tarif standard → phase 3.

## Charges et compte d'exploitation

Chaque charge a une **catégorie** (hébergement et services techniques, contenus et licences, logiciels, frais de paiement,
publicité, honoraires, banque et assurances, loyer, impôts et taxes, coaching, personnel, autres), un **type**
(fixe par mois, ponctuelle, par cliente active, par inscription, % du CA) et se rattache à un produit ou à toute l'application.

- **Démarrage relatif au calendrier** : début des prévisions, démarrage du produit, lancement commercial, ouverture des
  abonnements (+ décalage en mois), ou date précise. Si la date repère bouge, la charge suit.
- **Montée en charge** : paliers « au bout de X mois, nouveau montant ».
- **Estimation ou confirmé** : chaque charge reste une estimation tant qu'elle n'est pas confirmée ; un montant à 0 est
  signalé « à compléter » (loyer, salaire, rémunération de la dirigeante…).
- Le tableau « Montée en charge » montre les charges fixes mensuelles au début, au lancement, à +6 mois, +1 an et +2 ans.

Les montants pré-remplis sont des estimations (seul YMove, 29 € / mois, est confirmé).
Le coaching est valorisé à un coût horaire multiplié par les heures de chaque programme. Une charge variable commune est
répartie exactement entre les produits ; une charge fixe commune reste dans la colonne « Commun ». Les charges de structure
Om Holistic sont réparties entre les applications au prorata du CA ou à parts égales. Si les prix sont saisis TTC, le compte
les convertit en HT.

Contribution d'un produit = CA − frais − coûts variables − coaching − charges fixes rattachées.
Résultat d'exploitation = somme des contributions − charges fixes communes − quote-part de structure.
L'onglet Résultat présente aussi le **compte d'exploitation par nature** (une ligne par catégorie).

## Implantation de la société

Réglages › Implantation : chaque scénario (France micro-entreprise, SASU, LLC Wyoming avec résidence en France, au Belize
ou en République dominicaine…) a ses frais de structure annuels, ses cotisations sociales (sur le bénéfice ou le CA), son
impôt, un impôt sur les dividendes et un éventuel plafond de CA. L'onglet Résultat calcule le net de la société pour
l'implantation retenue et compare tous les scénarios. **Taux indicatifs, à faire valider par un conseiller.**

## Calcul

Le moteur (`js/engine.js`) simule semaine par semaine, puis répartit chaque semaine entre les mois
au prorata des jours, pour éviter les écarts entre mois de 4 et de 5 lundis. Résiliation mensuelle
des abonnements = 1 / durée moyenne (0 = aucune résiliation).

## Fichiers

- `js/model.js` : valeurs par défaut, grilles de prix, migration des sauvegardes
- `js/engine.js` : simulation
- `js/pnl.js` : compte d'exploitation
- `js/app.js` : interface
- `tests/engine.test.js` : tests du calcul, à lancer avec `node --test tests/engine.test.js`
