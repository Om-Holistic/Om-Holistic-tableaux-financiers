# Om Holistic — Tableau de bord financier

Prévisionnel des applications Om Holistic (Chrysalis d'abord, puis Bujo et Doodle Studio).
Application statique, sans serveur : ouvrir `index.html`, ou activer GitHub Pages sur `main` / racine.
Pensée pour le téléphone d'abord (onglets en bas), puis l'iPad et l'ordinateur (barre latérale).

Ce sont des hypothèses de simulation, pas des données observées. Les paramètres restent dans le
navigateur : exporter régulièrement le fichier JSON depuis la page Réglages.

## Pages

- **Vue d'ensemble** : CA de la période, part programmes / abonnements, résultat, graphique mensuel, revenus par produit.
- **Résultat** : compte d'exploitation par produit (abonnement, chaque programme, commun) ou par application en vue consolidée.
- **Prévisionnel** : un bloc dépliable par trimestre, mois par mois, avec charges et résultat, puis la capacité de coaching.
- **Charges** : charges de chaque application et charges de structure Om Holistic.
- **Produits et prix** : programmes (durée, rythme d'inscriptions, promotions) et abonnements.
- **Réglages** : application, capacité, TVA, import / export.

Applications par défaut : Chrysalis, Bujo et Doodle Studio (abonnement mensuel à 9,90 €, avec une phase « Lancement » à ajuster).

## Prix en trois phases

Chaque produit (programme, abonnement direct, abonnement après programme) a trois phases de prix,
chacune avec un nom, un mois de début et un prix. Le prix appliqué est celui de la dernière phase
commencée ; avant la première date, la première phase s'applique ; une phase sans date est ignorée.
Pour un programme, le prix est le **prix total**, payé à l'inscription. Pour les abonnements, une option
permet aux abonnées de garder le prix de la phase où elles se sont abonnées.

Les anciennes sauvegardes sont converties automatiquement : tarif bêta → phase 1,
tarif de lancement → phase 2, tarif standard → phase 3.

## Charges et compte d'exploitation

Chaque charge a un type et se rattache à un produit ou à toute l'application :

- **fixe** (€ / mois), **par cliente active** (€ / cliente / mois), **par inscription** (€), ou **% du CA** ;
- le coaching est valorisé à un coût horaire (0 par défaut) multiplié par les heures de chaque programme.

Une charge variable commune (pourcentage, par cliente, par inscription) est répartie exactement entre les produits ;
une charge fixe commune reste dans la colonne « Commun ». Les charges de structure Om Holistic sont réparties
entre les applications au prorata du CA ou à parts égales. Si les prix sont saisis TTC, le compte les convertit en HT.

Contribution d'un produit = CA − frais − coûts variables − coaching − charges fixes rattachées.
Résultat d'exploitation = somme des contributions − charges fixes communes − quote-part de structure.

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
