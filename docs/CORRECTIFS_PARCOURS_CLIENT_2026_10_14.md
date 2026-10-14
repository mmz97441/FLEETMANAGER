# Corrections du parcours client — 4.38.0

Cette livraison traite les 21 points de l’[audit 4.37.0](AUDIT_PARCOURS_CLIENT_2026_10_14.md). La revue a privilégié les corrections à la frontière serveur, puis aligné les formulaires, le suivi et les documents sur ces règles. Les demandes à l’exploitation sont désormais accessibles depuis le colis et le tableau de bord.

## Décisions et couverture

| Points | Correction retenue et raison | Vérification principale |
| --- | --- | --- |
| C01 | Contrat d’adresse partagé : destinataire, rue, code postal à cinq chiffres et ville. Refus atomique des nouvelles lignes incomplètes, avec motif par ligne ; reprise des anciennes références sans réécriture. | `shipmentContract.test.ts`, `test-client-creation.cjs` |
| C02 | Date calendaire et heure souhaitée séparées. Les entrées et affichages utilisent La Réunion. Une heure seule ne crée pas artificiellement un créneau. | Conversion puis dispatch du même jour sur émulateur ; tests de fuseau et de migration. |
| C03 | Les erreurs d’écriture remontent au formulaire. Aucun succès ni audit « confirmé » avant résultat ; saisie conservée. | `clientActions.test.ts`, `clientMutation.test.ts`, recette portail. |
| C04 | Nettoyage explicite des champs facultatifs et validation dans le callable du carnet. | Quatre combinaisons email/consignes, serveur réel émulé. |
| C05 | Capture canonique du prix, des conditions et de la demande affichée, plutôt qu’un simple compteur de version. Le serveur compare et conserve cette capture dans la transaction. Confirmation lisible sur mobile, avec créneau. | Prix, conditions ou trajet modifiés : refus sans colis créé ; acceptations concurrentes : un seul colis. |
| C06 | Abonnement ciblé à la fiche ouverte et aux tentatives dont la preuve reste à publier. Statut terrain et disponibilité de la preuve distincts. | `parcelFeed.test.ts`, publication tardive et sortie de la première page. |
| C07 | Même modèle métier pour preuve écran et impression : réserves, résultat, adresse figée, références, photos et signature. L’impression attend les images. | Tests de présentation et recette navigateur avec « 2 boîtes écrasées ». |
| C08 | Dates, créneaux, durée et étage conservés par ligne d’import ; colonnes ignorées signalées. Une date historique reste importable avec avertissement. | Parseur et service d’import, vérification des contraintes côté serveur. |
| C09 | Accusé par lot de 75 et identités stables. Lignes confirmées, refusées et résultat inconnu séparés ; impression des confirmations reçues. | Coupure après le premier lot, reprise sans nouvelles références. |
| C10 | Recherche sur références colis, transporteur, commande et référence client. Chargements en cours mutualisés ; historique confirmé réutilisé, actualisation explicite. | Saisie progressive dans le navigateur ; tests du flux de données. |
| C11 | Ouverture du détail indépendante du filtre ; tous les colis chargés du destinataire/jour restent visibles. Résumé avec comptes explicites, sans vert de fin avec historique partiel. | Dix colis, neuf livrés et un absent ; recherche et ouverture du détail. |
| C12 | Statut « en livraison » conservé quand le GPS manque ; fraîcheur de position affichée séparément. | Navigateur à 320, 390 et 1280 pixels. |
| C13 | Absence à l’enlèvement, décision de retour, relivraison et remise à l’expéditeur distinguées. Le mouvement de retour final conserve sa décision. | Statuts et timeline, tests de récupération logistique. |
| C14 | Références colis et commande réelles transmises à la preuve ; dates explicitement en heure Réunion. | Preuves sous fuseaux Paris/Réunion et affichage autour de minuit. |
| C15 | Cache local et confirmation serveur distingués. Réconciliation des retraits, pagination autoritative et attente des vérifications en cours avant export. | Flux testé avec cache, retrait, mises à jour concurrentes et déconnexion. |
| C16 | Absence d’échantillon distincte de zéro ; tendances seulement si comparables. Encours ancien visible et alertes alignées sur les filtres. | `clientAnalyticsHistory.test.ts`, indicateurs et réponses analytiques. |
| C17 | Événements filtrés sur la destination figée de la tentative ; encours sur sa destination actuelle. Zone historique inconnue signalée au lieu d’être inventée. | Échec chez A puis livraison chez B, filtres et exports séparés. |
| C18 | Carnet identifié par destinataire/rue/ville, avec usages enlèvement/livraison combinables. Champs vides effacés explicitement ; consignes reprises et modifiables. | Transactions concurrentes, destinataires distincts, effacement et préremplissage. |
| C19 | Profil, invitation et email en file créés atomiquement. Identité email unique, reçus de reprise et renvoi avec identifiant du profil. Doublons historiques soumis à contrôle, sans fusion automatique. | Invitations concurrentes, rejouées, compte existant et droits interentreprises. |
| C20 | Intervention revalidée après journalisation. La clôture annule les intentions non lancées et attend les opérations déjà engagées. | Arrêt pendant l’attente et changement de session. |
| C21 | Exports Excel et PDF dans l’écran utilisé, après relecture serveur. Tentatives de la période séparées de la situation actuelle ; filtres et réserves conservés. | Export historique A/B, coupure, cache, fenêtre bloquée et changement de compte. |

Les bons de livraison reprennent le groupe complet affiché, avec la date, le créneau et les preuves propres à chaque colis. La preuve d’un colis n’est jamais étendue implicitement aux autres.

## Demandes à l’exploitation

Le client peut signaler un colis manquant, proposer une correction d’adresse, demander une nouvelle livraison ou une annulation selon l’état du colis. Une référence de réception, un historique et une réponse explicite rendent le traitement consultable. La demande conservée sur l’appareil est rejouée avec la même identité après une coupure.

L’exploitation reçoit la demande dans la gestion des missions. Le traitement utilise une version vérifiée et un reçu d’opération ; deux opérateurs ne peuvent pas écraser leurs réponses. Ce circuit ne modifie pas directement le colis, la tournée ou les preuves : les opérations logistiques existantes restent responsables de ces changements.

## Vérification des données existantes

Le 14 octobre 2026, l’inventaire en lecture seule de `fleet-genius-app` a examiné **1 147 colis** : **0 adresse à compléter**, **0 date à migrer**, **0 écriture**. La migration reste disponible pour une autre base ou de futurs imports historiques. Elle ne dérive une date que depuis le devis source vérifié et exclut les colis affectés et les historiques terminaux.

Ce contrôle ne mesure pas l’exactitude physique des adresses ni l’absence de doublons dans les carnets : ces informations nécessitent une vérification métier. Les anciennes preuves sans zone figée conservent une zone historique non renseignée.

## Validation et livraison

Les régressions serveur ajoutées à `npm run test:server` sont `test-client-creation.cjs` et `test-client-actions.cjs`. Les tests couvrent les reprises et refus, pas seulement le parcours nominal. Les recettes navigateur utilisent les vrais composants avec données fictives et services isolés ; leurs résultats et captures se trouvent dans [les preuves de correction](validation/client-corrections-2026-10-14/).

Les fichiers de l’audit initial sont des preuves de défauts sur le commit 4.37.0. Leurs assertions historiques ne constituent pas des tests du produit corrigé.


Résultats finaux locaux : **537 tests unitaires**, **105 assertions navigateur** (65 portail, 20 preuves/analyse, 20 actions), TypeScript et compilations frontend/serveur réussis. La suite complète `test:emulated` passe : 70 contrôles Firestore, 39 tests d’intégration, toutes les suites serveur, 10 contrôles Storage, 42 contrôles de vote et 6 tests d’audit. Après les dernières finitions, les scénarios création (8) et actions client (49) ont été réexécutés avec succès. Le contrôle UI ne relève aucune violation sur les 62 fichiers inventoriés.

Déploiement du 14 octobre 2026 : les 12 fonctions concernées sont actives en production, les trois index de demandes client sont prêts et les règles Firestore ont été publiées. Les 12 routes refusent les appels anonymes avec `UNAUTHENTICATED` et acceptent l’origine de l’application. Les métadonnées de déploiement et les résultats de ces contrôles sont conservés dans [backend-release.json](validation/client-corrections-2026-10-14/backend-release.json).

La version frontend 4.38.0 est publiée par le projet Vercel `fleetmanager` depuis `main`. La [PR de livraison #22](https://github.com/mmz97441/FLEETMANAGER/pull/22) suit la fusion, la CI et la vérification de la version publique. Aucun colis ni document métier de production n’a été créé par les contrôles de déploiement.
