# Fiabilisation du flux logistique — 4.36.0

L’audit du 14 octobre 2026 a identifié treize familles de frictions, conservées dans [le rapport initial](AUDIT_FLUX_LOGISTIQUE_2026_10_14.md). Cette livraison corrige le parcours de création à l’analyse et ajoute des contrôles serveur pour que les validations restent cohérentes après une coupure réseau ou une double action.

## Résultat attendu

| Étape | Correction |
| --- | --- |
| Création et import | Expéditeurs génériques, zéros initiaux préservés, références canoniques et réservations atomiques ; date, créneau et durée conservés. |
| Identification | Référence individuelle unique exigée pour identifier un carton ; commandes partagées conservées, scan ambigu refusé explicitement. |
| Regroupement | Même destinataire, adresse et étage, avec créneaux compatibles ; arrêt de 1 à 10 colis et plus, expéditeurs mixtes. |
| Planification | Hub physique contrôlé, changement de date ou créneau motivé, correction colis/arrêt atomique et notification chauffeur. |
| Prise en charge | Brouillons persistants, collecte partielle explicite, cartons manquants libérés pour une nouvelle collecte. |
| Livraison | Scans successifs, confirmation verte ou croix rouge, formulaire et preuve communs aux colis remis, résultats partiels distincts. |
| Preuves | Heure terrain distincte de la réception serveur, preuve d’échec consultable, adresse figée, projections client limitées au colis concerné. |
| Retours | Retour physique avec preuve, attente de décision au hub, relivraison explicite ou retour définitif à l’expéditeur. |
| Reprise | File des dossiers anciens, relance de collecte, réception entre hubs et reprise des opérations hors connexion. |
| Clôture | Vérification de tous les colis liés à la mission, y compris ceux sortis d’un arrêt. |
| Analyse | Calculs communs aux tableaux et exports ; tentatives datées, volumes créés distincts des livraisons, historique complet requis. |
| Chargement | Activité courante complète, historique paginé au bureau et côté client, chargement intégral explicite pour les analyses. |
| Versions | Dernière version et présence par appareil, mise à jour proposée en préservant les opérations locales en attente. |

## Validation

Les tests portent sur les véritables composants et fonctions métier, avec Firebase local et des données fictives. Les sondes navigateur simulent la caméra et les services ; elles ne remplacent pas l’essai sur téléphone décrit dans [le protocole terrain](test-scan-flux.md).

- Typage TypeScript, compilation frontend et serveur, contrats UI et contrôle des dépendances.
- Tests unitaires, règles Firestore et Storage, intégrations et régressions serveur.
- Dispatch : cinq contrôles navigateur de reprise après réponse perdue, une seule tournée et requête identique.
- Livraison : 49 contrôles navigateur, formats de 320 à 1365 pixels.
- Collecte/retours/reprise : 17 contrôles navigateur, persistance, hors connexion et séparation entre comptes et tentatives.
- Imports : trois scénarios navigateur avec références génériques et numériques, sans débordement.
- Migration : dry-run, application et répétition sur émulateur ; préservation des statuts et références d’origine.

Validation locale globale réussie : 398 tests unitaires, 39 intégrations, 70 contrôles de règles Firestore, 10 Storage, 42 règles de vote, 6 régressions d’audit unitaires et 7 scénarios serveur issus de l’audit. Toutes les suites serveur passent, dont 43 contrôles métier généraux, 18 identités, 7 corrections de planification, 22 retours/reprise et 9 preuves. Les contrats UI couvrent 54 fichiers et 378 commandes, sans écart statique. Les 74 contrôles navigateur passent.

Les 23 fonctions concernées ont été déployées et les trois nouveaux index sont prêts. Le résultat de publication du site et des règles est conservé dans la [PR #20](https://github.com/mmz97441/FLEETMANAGER/pull/20).

## Reprise des données historiques

Le script `scripts/migrate-parcel-references.cjs` est en lecture seule par défaut. L’option `--apply` ajoute les index de références et leurs réservations sans réécrire les numéros d’origine, les statuts ou les affectations. Les modifications concurrentes sont conservées et signalées. Les références partagées sont classées entre numéros de commande partagés et véritables collisions individuelles ; aucune association arbitraire n’est créée.

La vérification initiale des 1 147 colis a trouvé 154 références canoniques partagées dans l’historique : 65 numéros de commande partagés et 89 collisions impliquant une référence individuelle historique. Parmi les 270 colis actifs, aucun ne manquait de référence individuelle unique et aucun n’avait de référence individuelle ambiguë.

Une preuve du 9 octobre reste absente du serveur. Elle ne peut pas être reconstruite honnêtement à partir du seul statut de l’arrêt : il faut récupérer l’opération locale depuis l’appareil d’origine ou traiter le dossier avec les éléments opérationnels disponibles. La nouvelle file de reprise conserve cette anomalie visible.

## Résultat de la migration

Migration appliquée en production le 14 octobre 2026, puis vérifiée en lecture seule : 1 147 colis indexés, 1 579 réservations de références, zéro colis restant à indexer et zéro modification concurrente ignorée. Les 154 références partagées restent identifiées comme telles ; les 270 colis actifs disposent chacun d’une référence individuelle unique. Les statuts et affectations n’ont pas été modifiés par cette migration.

Un rapprochement supplémentaire, exécuté sans autoriser aucune écriture, a vérifié 424 colis liés à des arrêts de livraison terminés : aucune réparation de statut supplémentaire n’est justifiée par les preuves disponibles.
