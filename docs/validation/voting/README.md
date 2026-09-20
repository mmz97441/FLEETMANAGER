# Recette du module de vote — 20 septembre 2026

Tous les salariés, documents et résultats de ce dossier sont **fictifs**. Les scénarios ont été exécutés avec des émulateurs locaux et un navigateur isolé, sans création de votes en production.

## Résultats

- TypeScript, compilation des fonctions et compilation de production : réussis.
- Audit UI : 47 fichiers, zéro écart statique.
- Tests unitaires : **295 réussis**, dont les dates Réunion, les bornes du calendrier, le CSV et la génération de vrais PDF.
- Suite sur émulateurs : **215 contrôles réussis** (35 règles existantes, 32 intégration, 41 serveur existant, 13 cycle des missions, 22 scans, 36 serveur vote, 10 stockage existant, 26 règles vote).
- Recette Chrome : **25 contrôles réussis** à 320, 390 et 1365 pixels. Le module, les formulaires, les confirmations et les exports sont réels ; les appels Firebase sont remplacés par des réponses contrôlées. Le script bloque les domaines Firebase externes.
- Audit des dépendances frontend et fonctions : **zéro vulnérabilité signalée** au moment du contrôle.

Les tests du vote couvrent notamment les sessions révoquées, l'éligibilité, les brouillons privés et leur pagination, les droits direction, les dates, les votes blancs, le quorum, les égalités, les choix multiples, les votes simultanés, les nouvelles tentatives après clôture, les votes secrets/nominatifs, les résultats figés, le PV immuable, la confidentialité des annexes, les exemplaires signés et le refus des faux événements de journal.

Les essais dans le navigateur contrôlent la sélection et sa confirmation, l'absence de double requête, l'absence de confirmation avant réponse serveur, le reçu, le démarrage d'un scrutin programmé, la simple consultation, les documents, la publication, la clôture, le PV et le CSV. Les captures montrent le rendu mobile et ordinateur. La structure et le texte du PDF ont également été vérifiés avec PDFKit.

Ces essais ne remplacent pas une manipulation sur un iPhone physique ou la validation d'un modèle de PV particulier. Le périmètre et les décisions sont documentés dans [le guide du module](../../features/employee-voting.md).

## Rejouer

```sh
npm run typecheck
npm run audit:ui
npm test
npm run build --prefix functions
npm run build
firebase emulators:exec --project demo-fleet-production-audit --config firebase.test.json --only firestore,storage 'npm run test:emulated'
node scripts/voting/fixture.mjs
```

Les émulateurs nécessitent Java 21. Pour les écrans, démarrer Chrome dans un autre terminal avec `--headless=new --remote-debugging-port=0 --user-data-dir=/tmp/fleet-voting-browser --no-first-run about:blank`, puis lancer `node scripts/voting/probe.mjs`. La sonde écrit `browser.json`, les captures et `PV-FICTIF.pdf`.
