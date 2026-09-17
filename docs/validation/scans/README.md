# Validation de la correction des scans — 4.28.0

## Comportement

Le serveur choisit une tournée ouverte du chauffeur pour le jour de travail à La Réunion. Priorité à la tournée explicitement affichée, puis à la dernière tournée confirmée du chauffeur, puis à une tournée en cours ou dispatchée du jour. Il crée une tournée si nécessaire, sans rouvrir une tournée clôturée.

- Premier scan : rattachement atomique du colis et de l’arrêt, reçu et journal.
- Nouveau scan de la même tournée : message « Déjà scanné », nouvel événement, aucun colis ou arrêt en double.
- Colis non livré d’une tournée antérieure : retrait de l’ancienne affectation, rattachement au jour courant et conservation de l’ancienne tournée dans l’historique.
- Livraison déjà prouvée, retour demandé/effectué ou preuve en attente : reprise refusée et raison affichée.
- Enlèvement : le scan vérifie le colis sans remplacer la validation de collecte et sa signature.
- Réception au dépôt et caméra de diagnostic : opérations distinctes, sans prise en charge implicite pour livraison.
- Réponse réseau incertaine : la tentative suivante reprend le même identifiant. Une transaction interrompue est retentée de façon bornée, sans multiplier ses écritures.
- Premier scan créant une tournée : l’écran de récupération reste monté jusqu’à la fin, pour conserver la file et les reçus.
- Caméra impossible à charger : saisie manuelle dans le même parcours, sans rechargement automatique de la tournée.

Les scans de chargement au dépôt suivent désormais cette règle de prise en charge physique, y compris un colis d’une autre tournée ; le transfert est historisé. Les comptes bureau choisissent un véritable chauffeur dans le chargement. Leur scanner de recherche ne les transforme pas en chauffeurs.

## Contrôles réalisés

- TypeScript et builds du front et des fonctions.
- 264 tests unitaires, dont 4 tests du service de scan : réponse incertaine et rechargement, callbacks concurrents, nouvelle lecture physique, contexte partagé et changement de jour.
- Suite émulateurs : 35 contrôles de règles, 32 tests d’intégration, 41 contrôles serveur existants, 13 contrôles de clôture et 10 contrôles de stockage.
- 22 scénarios du nouveau serveur de scan : voir `scripts/test-scan-package.cjs`. Aucun colis réel utilisé.
- Audit UI statique sans écart ; 25 contrôles navigateur sur les vrais composants de scan/historique avec services simulés : `browser.json` et `driver-first-tour.json`. Le véritable écran chauffeur conserve deux scans lors de la création de sa première tournée, puis ouvre l’identifiant retourné par le serveur. Captures à 320, 390 et 1365 px.
- Lecture seule du projet réel : filtre chauffeur + date accepté par Firestore (HTTP 200) ; pas d’index supplémentaire nécessaire pour cette requête.

Les tests automatisés ne constituent pas un essai de caméra sur les téléphones des chauffeurs. La saisie, les états d’attente, la reprise, les messages et le rendu ont été vérifiés ; la reconnaissance optique dépend toujours de la caméra et de l’étiquette physique.

## Rejouer les vérifications

```sh
npm run typecheck
npm test
npm run audit:ui
npm run build --prefix functions
npm run build
firebase emulators:exec --project demo-fleet-production-audit --config firebase.test.json --only firestore,storage 'npm run test:emulated'
```

Utiliser Java 21 ; si le runtime français pose problème, ajouter `JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US'`.

Pour les essais visuels, démarrer `node scripts/scan/fixture.mjs` (port 5245), puis une instance Chrome isolée avec `--headless=new --remote-debugging-port=0 --user-data-dir=/tmp/fleet-scan-browser --no-first-run about:blank`. Exécuter `node scripts/scan/browser-probe.mjs`. Les appels Firebase externes sont bloqués par la sonde et tous les services métier sont simulés.

## Décisions et périmètre

L’heure et le jour de rattachement sont décidés par le serveur, pas par l’horloge du téléphone. Aucune migration de masse des colis historiques : une reprise nécessite un scan effectif. Les anciens événements sans heure de scan fiable ne reçoivent pas d’horodatage inventé. La création manuelle utilise une identité stable pour éviter un second colis lors d’une reprise après échec de confirmation.

Le diagnostic global de simplification est fourni dans `docs/ux/DIAGNOSTIC-SIMPLIFICATION-2026-09-17.md`. Il s’agit de recommandations pour une prochaine évolution, distinctes de cette correction.

Pour rejouer le cas de la première tournée, démarrer également `node scripts/scan/driver-fixture.mjs` (port 5246), puis exécuter `node scripts/scan/driver-probe.mjs` avec la même instance Chrome isolée. Le composant `DriverMissionView` est réel ; les services sont simulés.
