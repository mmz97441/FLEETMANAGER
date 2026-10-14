# Livraison groupée par BR — 4.34.0

Le chauffeur voit les BR à prendre dès l’ouverture de l’arrêt. Pour trois cartons de la même pharmacie, il scanne les trois BR à la suite, renseigne une fois le réceptionnaire, prend une photo et recueille une signature. Une seule confirmation enregistre la preuve commune pour les trois colis.

## Regroupement et contrôles

- Les références BR sont prioritaires sur le numéro interne GFL dans les listes du chauffeur. Les références des colis attendus sont chargées par leurs identifiants exacts ; un échec de lecture conserve le compteur attendu et propose de recharger.
- Les arrêts de livraison en attente d’une même tournée sont présentés ensemble lorsqu’ils ont le même destinataire nommé, l’adresse complète normalisée, l’étage et les créneaux planifiés identiques. Les BR et les numéros de commande peuvent différer. Un téléphone commun ne suffit pas à autoriser une preuve commune.
- À l’arrivée, `prepareDeliveryStop` réunit ces arrêts dans une transaction serveur, conserve l’identifiant de l’arrêt sélectionné, réaffecte les colis et supprime les arrêts devenus vides. Le rattachement explicite passe également par cette transaction ; il ne laisse plus un colis dans deux arrêts.
- La tournée doit appartenir au chauffeur actif, être ouverte et datée du jour à La Réunion. Les colis livrés, retournés, transférés, les preuves existantes et les autres arrêts déjà commencés sont protégés. Les fenêtres propres aux colis peuvent être plus larges que la visite planifiée.
- Le contrôle serveur de chaque scan confirme l’appartenance à l’arrêt. Un autre destinataire est refusé ; un BR déjà confirmé ne gonfle pas le compteur. Le formulaire commun s’ouvre après le dernier contrôle terminé.
- Le stockage de preuve existant reste idempotent et associe la même photo, la même signature et le même réceptionnaire à chaque colis remis. Les parcours d’échec, de remise partielle et de synchronisation des preuves sont conservés.
- L’événement serveur `DELIVERY_STOP_PREPARED` est protégé contre la création directe depuis le navigateur.

## Validation

- TypeScript frontend et serveur, compilations, audit UI, audit des dépendances et contrôle des différences Git.
- 356 tests unitaires et 33 tests d’intégration, dont l’écriture réelle dans les émulateurs d’une preuve commune à trois BR différents et sa reprise sans doublon.
- Suite complète Firestore, Storage et serveur ; 10 contrôles supplémentaires du regroupement (concurrence, double affectation historique, créneaux, droits, transfert, preuve existante et refus atomique). Contrôle supplémentaire interdisant la falsification de l’audit de préparation.
- 15 contrôles navigateur à 320, 390 et 1365 pixels : BR visibles avant arrivée, refus d’un mauvais colis, scan continu, doublon, formulaire commun, envoi unique, remise à zéro à l’arrêt suivant et reprise d’une lecture échouée. Caméra et données fictives, accès aux services distants bloqué.
- Les fichiers de tests d’intégration sont exécutés séquentiellement : ils partagent les émulateurs et leurs contextes de règles Firestore/Storage. Les tests de concurrence internes restent actifs.

## Publication

Déployer `functions:prepareDeliveryStop` avant le frontend 4.34.0, puis les règles Firestore. Vérifier la version publique et l’ouverture de l’application sur mobile et ordinateur. Les appareils doivent actualiser après sauvegarde des opérations en cours, sans effacer les preuves locales.

Aucun colis réel n’est livré ou réaffecté par les tests. Le parcours caméra doit encore être confirmé sur un téléphone physique en tournée.
