# Audit du flux logistique du 14 octobre 2026

Le parcours courant de livraison groupée fonctionne dans les scénarios vérifiés, mais la chaîne complète présente encore des blocages et des incohérences. Les priorités sont l’import des autres expéditeurs, l’identité du destinataire lors des regroupements, la propagation des corrections d’adresse et la reprise des colis non terminés.

Périmètre : création et import, réception au hub, affectation et chargement, prise en charge et transferts, remise groupée, preuves et synchronisation, échecs et retours, suivi et indicateurs. Version examinée : **4.35.0**, commit `5413af17ef98378b2983672320d1766abaed43cb`. La version publiée a également été relue sur `https://delivrex.vercel.app/version.json`.

Cet audit ajoute des reproductions et ce compte rendu. Aucun correctif fonctionnel ni changement de données métier n’a été déployé pendant ce contrôle.

## Situation observée en exploitation

Lecture seule à **07 h 35, heure de La Réunion**, le 14 octobre. Échantillon exhaustif des requêtes effectuées : **349 colis créés depuis le 14 septembre**, **91 tournées datées depuis le 14 septembre**, **131 erreurs datées depuis le 7 octobre**. Les limites des requêtes n’ont pas été atteintes ; les données plus anciennes ne sont pas incluses.

- **116 colis** restent au statut « En livraison » sur des tournées du **15 septembre au 13 octobre**. Ce sont des états informatiques à rapprocher des remises réelles, pas une preuve que ces colis sont perdus.
- **40 tournées** restent « En cours », toutes antérieures au 14 octobre. Certaines peuvent être vides après transfert : leur nombre ne mesure pas, à lui seul, le travail restant.
- **Un arrêt terminé le 9 octobre à 11 h 43** porte encore `proofSyncPending`. Il faut vérifier la preuve et le téléphone qui l’a enregistrée avant toute clôture ou réaffectation.
- Pour **12 profils de chauffeurs ayant signalé une présence depuis le 13 octobre**, la dernière version connue est encore **4.32.0**. Cela ne prouve pas qu’ils utilisent tous cette version maintenant ; il faut vérifier leur prochain signal de présence. La publication de 4.35.0 ne suffit donc pas à confirmer son adoption.
- Les **131 erreurs** consultées mentionnent 4.32.0 ou des versions antérieures. Aucune ne permet d’attribuer un incident à 4.35.0. Le dernier événement de scan du périmètre est daté du 13 octobre : le comportement de 4.35.0 sur de vrais scans terrain reste à confirmer.
- Dans ces 349 colis, les affectations actuelles relues correspondent aux arrêts et aux chauffeurs. Aucun identifiant partagé entre plusieurs colis ni arrêt comportant plusieurs noms de destinataire n’a été détecté dans ce périmètre. Le risque de regroupement décrit ci-dessous est reproduit sur données fictives.

Les agrégats sans noms, adresses ni références réelles sont conservés dans [production-summary.json](validation/logistics-2026-10-14/production-summary.json).

## Constats et corrections durables

**P1** : à traiter en premier pour éviter un blocage métier ou une remise au mauvais destinataire. **P2** : fiabilité de la reprise, traçabilité et suivi. « Reproduit » signifie que le comportement a été exécuté sur des données fictives ; cela ne signifie pas qu’un incident identique a été constaté en production.

| Référence | Priorité | Étape | Friction confirmée | Correction durable |
| --- | --- | --- | --- | --- |
| LOG-01 | P1 | Import expéditeur | L’espace client refuse toujours un numéro qui ne commence pas par BR. `EXP-A/0042` et `000012345678` sont rejetés avant envoi. | Utiliser la même validation d’identifiant individuel pour tous les expéditeurs. Appliquer les règles Boiron uniquement au format Boiron explicitement choisi. |
| LOG-02 | P1 | Affectation, prise en charge et livraison | Deux destinataires à la même adresse peuvent devenir un seul arrêt. Le contrôle de livraison accepte ensuite le colis du second destinataire dans cet arrêt. | Partager une règle de destinataire, adresse, étage et créneau sur tous les chemins. Revalider aussi les colis déjà présents dans l’arrêt. |
| LOG-03 | P1 | Dispatch et hub | Un colis enregistré au hub B peut être affecté à une tournée partant du hub A. Le jour de livraison souhaité reste un simple avertissement dans l’interface. | Vérifier le hub physique côté serveur, organiser les transferts entre hubs, filtrer les colis par départ et date. Une dérogation de date doit être explicite et tracée. |
| LOG-04 | P1 | Correction avant livraison | Modifier l’adresse de l’arrêt ne corrige pas le colis ; modifier le colis ne corrige pas l’arrêt. Le chauffeur et le client peuvent voir des destinations différentes. | Une correction transactionnelle met à jour les représentations concernées, invalide coordonnées et estimations, et avertit le chauffeur. Protéger les remises déjà commencées. |
| LOG-05 | P1 | Échec, retour et relivraison | Le retour confirmé au hub met le colis dans un statut terminal « Retourné ». Il ne peut plus être repris par scan, réceptionné ou dispatché normalement. Les colis « Échec » ne figurent pas dans la liste chauffeur « À retourner ». | Distinguer retour au dépôt en attente de nouvelle tentative et retour définitif à l’expéditeur. Ajouter une décision guidée après échec et une relivraison avec historique des tentatives. |
| LOG-06 | P2 | Clôture | Le serveur vérifie les colis encore dans les arrêts, mais peut clôturer une tournée ayant un colis « À retourner » dont l’arrêt a été supprimé. | Vérifier aussi tous les colis liés à la mission, y compris ceux hors de la liste des arrêts, dans la transaction de clôture. |
| LOG-07 | P2 | Preuve d’échec et analyse | Le motif choisi est conservé dans la preuve interne et le texte du mouvement, mais pas dans `package.failureReason`, utilisé par les graphiques. La preuve d’échec n’est pas publiée sur le colis pour l’espace client. | Enregistrer le motif structuré et une référence de preuve par tentative ; permettre au client et au bureau de consulter cette tentative selon leurs droits. |
| LOG-08 | P1 | Reconnaissance des références | Une référence enregistrée en minuscules peut être introuvable lorsqu’elle est scannée en majuscules. L’identifiant affiché et les requêtes exactes ne partagent pas la même normalisation. | Conserver le libellé original et indexer une valeur canonique pour les recherches, sans supprimer les zéros. Prévoir une migration des références existantes et les contrôles de collision. |
| LOG-09 | P2 | Indicateurs | « Taux de livraison » utilise plusieurs dénominateurs. Certains calculs ignorent les retours. Une livraison peut être rangée au jour de création du colis plutôt qu’au jour de remise. | Séparer volume créé, taux de traitement, succès des tentatives et remises réalisées par jour. Partager les formules entre tableaux, exports et analyse IA. |
| LOG-10 | P2 | Synchronisation hors réseau | Une remise saisie hors réseau conserve son heure dans la preuve et l’arrêt, mais le mouvement `DELIVERED` reçoit l’heure de synchronisation. | Stocker séparément l’heure métier de la remise et l’heure de réception serveur. Utiliser la première dans les délais et la ponctualité. |
| LOG-11 | P2 | Enlèvement partiel | Un colis déclaré manquant conserve son affectation à l’arrêt d’enlèvement terminé. La réception au hub le refuse et la tournée peut être clôturée en conservant ce lien. | Conserver la décision dans le manifeste historique, libérer l’affectation opérationnelle du manquant et proposer une collecte ultérieure. |
| LOG-12 | P1 | Reprise du travail ancien | Le chauffeur charge les tournées du jour. Les anciens colis actifs ne constituent pas une file de reprise explicite ; une reprise par scan existe, mais exige de retrouver physiquement le carton. | Afficher au bureau et au chauffeur les colis à résoudre des jours précédents, avec actions : vérifier la preuve, reprendre, retourner, replanifier ou constater un incident. |
| LOG-13 | P2 | Adoption des correctifs | Les dernières versions remontées par les chauffeurs sont antérieures à la publication actuelle. Le bandeau de mise à jour nécessite une action. | Suivre la version et la fraîcheur de présence par appareil, proposer la mise à jour à un moment sans saisie active, puis vérifier le nouveau signal de présence. Préserver les preuves locales. |

### Détails des reproductions

**Import multi-expéditeurs.** Le contrôle est dans [ImportShipmentsModal.tsx](../src/components/ImportShipmentsModal.tsx), autour de la ligne 208. La colonne « Code transporteur » est aussi assimilée au code Boiron de 22 chiffres dans les deux imports. Le serveur accepte pourtant des références individuelles non BR. La [capture du rejet d’un autre expéditeur](validation/logistics-2026-10-14/other-sender-rejected.png) montre le blocage réel dans le composant, à une largeur de 390 pixels. Aucun envoi réel n’a été créé.

**Regroupement et contrôle du destinataire.** La prise en charge dans [scanPackage.ts](../functions/src/scanPackage.ts), l’optimisation dans [gmproService.ts](../src/services/gmproService.ts), et l’ancien callable `transferPackages` groupent par adresse. Le contrôle strict de [prepareDeliveryStop.ts](../functions/src/prepareDeliveryStop.ts) ne compare le destinataire que pour les colis nouvellement ajoutés au regroupement. Un colis déjà mal regroupé échappe donc à cette vérification. Reproduction : pharmacie A au rez-de-chaussée de 8 h à 9 h, cabinet B à l’étage 2 de 14 h à 15 h, même adresse. Résultat : un arrêt au nom de A, créneau de A, et scan de B accepté à la livraison. Une prise en charge supplémentaire peut également ajouter un colis à un arrêt déjà « Arrivé », ce qui impose au chauffeur de reprendre sa vérification.

**Hub et date.** [dispatchMissions.ts](../functions/src/dispatchMissions.ts) contrôle la disponibilité du colis, l’adresse, le chauffeur, son absence et le véhicule. Il ne compare pas `currentHubId` au hub de départ. Reproduction : hub B, livraison souhaitée le 16 octobre, affectation acceptée depuis A pour le 14 octobre. L’interface de [DispatchManager.tsx](../src/components/DispatchManager.tsx) sélectionne les colis par zone sans les restreindre au hub de départ ; elle signale la différence de date sans la bloquer.

**Corrections d’adresse.** [missionStopEditor.ts](../src/services/missionStopEditor.ts) invalide correctement les estimations, mais ne reporte pas l’adresse sur les colis. [updatePackageFields](../src/services/missionService.ts) fait l’inverse : il ne met à jour que le colis. Reproduction : adresse initiale « 1 rue Ancienne », arrêt modifié en « 2 rue Corrigée », colis ensuite modifié en « 3 rue Autre » ; les deux documents restent divergents.

**Retours et clôture.** [returnPackage dans index.ts](../functions/src/index.ts) crée le statut « Retourné » ; [hubReception.ts](../functions/src/hubReception.ts), le scan et le dispatch le refusent ensuite. [DriverMissionView.tsx](../src/components/DriverMissionView.tsx) ne liste pour retour que les colis « À retourner », pas les « Échec ». Le hub de retour est déduit de l’ancienne affectation et peut être absent pour une tournée créée sur le terrain. Par ailleurs, [missionLifecycle.ts](../functions/src/missionLifecycle.ts) peut terminer une mission vide alors qu’un colis « À retourner » lui reste lié. L’interface courante possède un garde-fou sur les retours ; le défaut reproduit concerne le contrôle serveur, notamment si une vue est périmée.

**Échecs, heure et indicateurs.** [commitStopOutcome](../src/services/missionService.ts) écrit le statut et le texte du mouvement sans motif structuré et date le mouvement au moment de l’appel. [podService.ts](../src/services/podService.ts) conserve le motif dans la preuve interne d’échec, mais ne copie de preuve sur le colis que pour un succès. Exemple chiffré : **1 livré, 2 retournés, 1 en livraison, 1 en attente** donnent **33 %** dans `ClientKPIs`, **50 %** dans `clientMetrics` et **20 %** dans `MissionKPIs`. Ces mesures peuvent avoir des usages différents, mais ne doivent pas porter le même sens pour l’utilisateur. Le calcul de ponctualité compare en outre la remise à une estimation d’arrivée ; une fin de créneau promise serait une autre mesure à nommer séparément.

**Enlèvements manquants.** [pickupService.ts](../src/services/pickupService.ts) termine l’arrêt et enregistre les manquants sans détacher leur affectation. Le manifeste empêche à juste titre de faire passer ces colis pour physiquement collectés au hub. Le parcours de collecte ultérieure manque ; il faut préserver cette protection en ajoutant la reprise opérationnelle.

## Autres frictions à prendre en compte

- La création unitaire ne propose pas la date souhaitée ni les créneaux proposés dans certains imports. Un même besoin reçoit donc un niveau d’information différent selon l’entrée choisie.
- Les scans d’enlèvement, signatures d’enlèvement et photos de retour restent dans l’état de l’écran avant confirmation. La boîte d’envoi persistante couvre les livraisons et leurs échecs, pas ces deux parcours. Une fermeture du navigateur peut donc imposer de refaire la saisie ou la preuve. Ce point est établi par lecture du code ; un essai sur les téléphones utilisés précisera son impact en situation de réseau dégradé.
- L’optimiseur remplace la durée de service importée par `5 minutes × nombre de colis`. Une durée particulière de 30 minutes peut ainsi être perdue. Des créneaux incompatibles à une même adresse bloquent toute l’optimisation au lieu de proposer deux visites distinctes.
- Les listes générales de colis et celles des clients chargent leur historique sans pagination. Cela évite les anciens colis invisibles, mais augmente progressivement les lectures et le travail du téléphone. Séparer les colis actifs en temps réel d’un historique paginé, sans remettre une limite qui cacherait du travail actif.
- L’ancien abonnement aux transferts trie sur `timestamp`, alors que les écritures serveur actuelles utilisent `createdAt`. Aucun appel de cet abonnement n’a été trouvé dans l’interface actuelle : dette à corriger avant sa réutilisation, pas blocage démontré du parcours actif.
- [Le protocole terrain existant](test-scan-flux.md) cible encore 4.6.0 et décrit l’acceptation d’une commande partagée. Il doit être actualisé pour les références individuelles, les autres expéditeurs et les cas de 1 à 10 colis ou plus.

## Vérifications exécutées

| Contrôle | Résultat et portée |
| --- | --- |
| TypeScript, compilation frontend et functions | Réussis. |
| Tests unitaires existants | **362 réussis**, 55 fichiers. |
| Tests d’intégration existants | **33 réussis**, 4 fichiers. |
| Suite des règles, serveur et stockage | Réussie, y compris dispatch, réception au hub, cycle de mission, scans et regroupement. Les contrôles de refus produisent des messages `PERMISSION_DENIED` attendus. |
| Parcours de livraison dans le navigateur | **49 vérifications réussies**, largeurs 320, 390 et 1365 pixels ; 1, 3, 10 colis, expéditeurs mixtes, doublon, mauvais colis, panne réseau, saisie manuelle, une preuve commune et séparation de l’arrêt suivant. Services et caméra simulés. |
| Reproductions ciblées de cet audit | **7 tests de caractérisation**, **7 observations serveur**, **3 fichiers d’import testés dans le navigateur**. Ils constatent le défaut actuel et devront devenir des tests du comportement corrigé lors des correctifs. |
| Dépendances | Aucune vulnérabilité serveur signalée. L’exception existante sur la chaîne de compilation frontend reste limitée au 13 novembre 2026 ; les cinq contrôles de sa politique passent. |

Les résultats positifs du parcours courant ne couvrent pas automatiquement les combinaisons révélées par cet audit. Une caméra physique et une tournée réelle n’ont pas été exercées par ces tests.

Reproduction locale des constats de services et du serveur :

```sh
npm --prefix functions run build
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
firebase emulators:exec --project demo-fleet-production-audit \
  --config firebase.test.json --only firestore,storage \
  'npx vitest run tests/audit --no-file-parallelism && node scripts/audit-logistics.cjs'
```

Le script serveur refuse de démarrer sans l’émulateur local. Pour la reproduction de l’import : lancer `node scripts/reliability/fixture.mjs`, ouvrir Chrome avec le profil temporaire `/private/tmp/fleet-logistics-browser` et le débogage local, puis lancer `node scripts/audit-logistics-ui.mjs`. Les requêtes du navigateur vers les services métier externes sont bloquées par la sonde.

Preuves conservées : [observations serveur](validation/logistics-2026-10-14/server-findings.json), [imports](validation/logistics-2026-10-14/import-ui-results.json), [livraison groupée](validation/logistics-2026-10-14/delivery-ui-results.json). Sources des reproductions : [script serveur](../scripts/audit-logistics.cjs), [tests de services](../tests/audit/logistics-services.test.ts), [tests de regroupement et indicateurs](../tests/audit/logistics-metrics.test.ts).

## Ordre de réalisation proposé

1. **Références et destinataires** : supprimer la restriction BR globale, unifier la recherche des codes et le regroupement, contrôler tous les colis à l’arrivée. Vérifier séparément les arrêts historiques avant de les modifier.
2. **Affectations cohérentes** : corriger ensemble le colis et l’arrêt, imposer le hub physique et rendre la décision de date explicite.
3. **Reprise des exceptions** : traiter la preuve du 9 octobre sur son appareil d’origine, proposer la reprise des 116 statuts anciens après rapprochement, ajouter la décision après échec et la relivraison après retour. Vérifier les colis hors arrêt à la clôture. Aucun classement automatique en « Livré » ne doit remplacer une preuve.
4. **Traçabilité et analyse** : publier les motifs d’échec, préserver les heures terrain, unifier les indicateurs et rendre persistants les enlèvements et retours en attente.
5. **Validation d’exploitation** : vérifier l’adoption de la version sur les appareils, puis dérouler une tournée témoin avec plusieurs expéditeurs, un enlèvement partiel, une livraison de 10 colis, une erreur de destinataire, une coupure réseau et une relivraison.
