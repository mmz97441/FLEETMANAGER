# Livraison des 28 points UX/UI — 4.26.0

Cette version traite les recommandations du rapport 4.25.0 du 10 septembre 2026. Trois sous-agents ont travaillé sur le bureau, le client et le terrain ; l’orchestrateur a intégré les changements, corrigé les services partagés et fait effectuer une revue croisée.

Les contrôles logiciels et Chrome avec données fictives sont distincts des essais physiques. **UI-27 reste à valider sur les téléphones et imprimantes réels.** Les mesures d’usage UI-20/21/28 restent à recueillir ; aucun résultat utilisateur n’est inventé.

## Décisions pour les 28 points

| Point | Décision appliquée | Vérification principale |
|---|---|---|
| UI-01 | Ajout/édition d’arrêt dans Modal ; protection de toutes les fermetures et de l’envoi ; reprise journalisée. | Bureau : fermetures, busy, reprise après reload. |
| UI-02 | Un état par source : chargement, vide confirmé, ancien résultat, erreur durable et reprise ciblée. | Bureau : lectures différées et cinq sources en erreur. |
| UI-03 | Attendre les deux sources de colis ; le GPS facultatif ne termine pas le chargement. Une source refusée interdit de présenter une liste partielle comme complète. | clientPackageSubscription.test ; client chargement/erreur/reprise. |
| UI-04 | Neuf champs arrêt nommés ; fenêtres héritées sur Modal, focus contenu et restauré. | Bureau : neuf labels, Tab/Maj+Tab, focus restauré. |
| UI-05 | Bouton de développement avec aria-expanded/controls ; impression et lien séparés. | Bureau : Entrée et Espace. |
| UI-06 | Alertes utiles assombries ; texte et icône conservés. | Alerte chauffeur : 7,09:1 sur blanc à 320/390 px. |
| UI-07 | Registre global des brouillons, sorties de vue et Retour/Avancer protégés, y compris après reload et vers Documents. | navigationGuard.test ; Chrome navigation et reload. |
| UI-08 | Validation explicite : champs requis, ZIP, durée 1–480 min, créneau complet et ordonné ; erreurs conservant la saisie. | missionStopForm.test ; missionStopEditor.test ; refus sans écriture. |
| UI-09 | Recherche colis globale indépendante du filtre des tournées ; une date de travail. | Bureau : recherche historique et indépendance des filtres. |
| UI-10 | Cartes de tournée mobiles, filtres repliables et retour à la ligne des contenus longs. | Bureau : aucun débordement à 320/390 px. |
| UI-11 | Commandes arrêt d’au moins 44 px et champs mobiles lisibles. | Bureau : dimensions et styles calculés. |
| UI-12 | Séparer fenêtre obligatoire et opération occupée ; GPS/Documents sans requête utilisent busy=false. | Contrat Modal, typecheck et garde navigation. |
| UI-13 | Panneaux QuickScan sur Modal ; échecs conservés par colis ; reprise d’un scan refusé possible. | Terrain : manifeste en erreur, reprise, brouillon, busy. |
| UI-14 | Messages communs à la place de alert ; invitation confirmée seulement après confirmation email. | Client : réponse false puis succès. |
| UI-15 | Trois groupes Destinataire/Colis/Options ; options repliées sans effacer les valeurs ; action finale dans le pied fixe. | Client : création à 320/390 px. |
| UI-16 | Demande incertaine datée et expliquée ; reprise du même identifiant et payload ; abandon avancé explicite. | pendingClientShipment.test ; Chrome reprise sans doublon. |
| UI-17 | Référence complète regroupée visuellement, copie exacte et partage natif si disponible. Aucun alias court ni migration d’identité. | shipmentReference.test ; copie exacte dans Chrome. |
| UI-18 | Consultation réellement en lecture seule. Intervention explicite, acteur/client visibles, audit préalable obligatoire ; échec de l’audit final ne transforme pas une écriture réussie en invitation à la rejouer. | clientMutation.test ; clientInterventionService.test ; fenêtres imbriquées. |
| UI-19 | Retirer les menus sans fonction ; les anciens liens expliquent la limite et orientent vers une fonction existante. | Revue Sidebar/App et compilation. |
| UI-20 | Urgences avant statistiques : incidents critiques, arrêts échoués, preuves explicitement en attente, affectations manquantes ; permissions respectées. | operationalQueue.test ; liens dossier, erreur/reprise. Seuil utilisateur de 10 s à mesurer. |
| UI-21 | Filtrer les tournées par date côté serveur, stabiliser les autres abonnements ; statistiques par vrais IDs de tournée sans plafonds silencieux ; conserver la recherche historique complète. | Benchmark 1 000/10 000 colis et abonnements. Mesures production à recueillir. |
| UI-22 | Libellés partagés et vouvoiement ; distinguer affectation/départ et retour à remettre/reçu. SKIPPED devient Non effectué sans promettre une reprogrammation. | Revue libellés et tests ; enums enregistrés inchangés. |
| UI-23 | Estimation d’arrivée pour calcul, Créneau demandé pour demande ; date si autre jour, texte de 14 px. Aucune fraîcheur GPS inventée. | Client : liste et estimation datée. |
| UI-24 | Tri dans URL ; huit favoris locaux maximum par compte. Seulement filtres/tri, jamais sélection, recherche personnelle ou ancienne date. | officeSavedViews.test ; reload, favoris et sélection. |
| UI-25 | Brouillon support avec aperçu et contexte optionnel : version, écran autorisé, heure et référence opaque ; copie/outil email. | supportContext.test ; aperçu mobile sans données métier automatiques. |
| UI-26 | Matrice versionnée par écran et état, preuves distinctes de la présence du composant ; tests de régression sur navigation, reprises, transactions et permissions. | UX28_COVERAGE.md et tests exécutés en CI. |
| UI-27 | Diagnostic volontaire caméra/GPS, étiquette fictive TEST et grille exportable dans Aide. Résultats physiques laissés Non testé. | Outillage vérifié dans Chrome ; séances Android/iPhone/imprimantes NON RÉALISÉES. |
| UI-28 | Mesures locales désactivables/exportables : recherche, création, affectation, livraison, synchronisation et chargement ; tâche/rôle/résultat et chiffres uniquement. | uxMetrics.test ; instrumentation des opérations. Comparaison d’usage réelle à recueillir. |

## Corrections supplémentaires issues de la revue

- Éditer, réordonner ou retirer un arrêt lit la tournée actuelle en transaction : les preuves et autres changements arrivés entre-temps sont conservés.
- Retirer l’arrêt et demander le retour des colis forme une seule opération. Un colis transféré ou déjà traité fait refuser l’ensemble, avec explication.
- Une adresse corrigée perd ses anciennes coordonnées. Une modification de parcours, durée ou créneau retire les anciennes prévisions sur les arrêts en attente et les colis exposés au client. Les données historiques des arrêts terminés restent intactes. Au-delà de 450 colis, la modification est refusée avec explication, sans mutation partielle.
- L’ajout manuel utilise une référence stable côté bureau et chauffeur, avec payload figé avant envoi. Une réponse perdue peut être vérifiée après rechargement, même après clôture si l’arrêt existe déjà. Le journal partagé tient compte des autres onglets et ne supprime que la référence confirmée. Un échec de stockage empêche le premier envoi.
- Le marquage de navigation survit au rechargement. La sortie vers les documents obligatoires interroge aussi les brouillons.
- Deux fenêtres de hub superposées ont été ramenées à une seule. Un lot d’import vide n’affiche plus tous les colis du client.

## Choix d’exploitation et limites

Validation locale finale : **243 tests unitaires** dans 39 fichiers, **127 contrôles sur émulateurs** (31 règles Firestore, 32 intégrations, 41 serveur, 13 cycle de tournée, 10 Storage), typecheck et compilations frontend/functions réussis. Les deux audits de dépendances indiquent zéro vulnérabilité. Les preuves navigateur compactes comprennent **116 contrôles/scénarios et mesures**, plus les 40 recherches du benchmark, sans exception JavaScript non traitée. Le build conserve l’avertissement connu sur le bloc Firebase de 650,69 kB minifié ; ce n’est pas une erreur de compilation.

Les identifiants et données existants restent compatibles. Aucun quota arbitraire de colis, migration de schéma ou remplacement du backend n’est introduit. Le déploiement du site passe par le projet Vercel **fleetmanager** ; le backend Firebase existant est conservé. Ce lot ne modifie ni règles ni fonctions déployées.

Les métriques restent locales à la session, limitées à 200 événements, sans nom, adresse, code colis, image, signature ou coordonnées. Leur export est volontaire. Le support ouvre un brouillon visible sans message envoyé automatiquement. Les favoris sont locaux à l’appareil et au compte.

Le benchmark bureau emploie des colis fictifs, une source différée de 30 ms et un composant déjà chargé. Dix recherches par cas retrouvent toutes le bon colis ; le dernier reste accessible par recherche et pagination.

| Cas | Première page | Recherche médiane | Recherche p95 |
|---|---:|---:|---:|
| Desktop, 1 000 colis | 75,1 ms | 32,8 ms | 33,8 ms |
| Desktop, 10 000 colis | 55,0 ms | 32,65 ms | 34,4 ms |
| Mobile 390 px CPU ×4, 1 000 colis | 109,8 ms | 32,15 ms | 34,3 ms |
| Mobile 390 px CPU ×4, 10 000 colis | 121,1 ms | 33,2 ms | 67,9 ms |

Ces valeurs n’incluent pas le téléchargement initial de l’application et ne démontrent ni gain avant/après ni baisse de facture Firestore. L’historique bureau des colis reste un abonnement intégral. Une pagination serveur future devra préserver les colis à traiter et la recherche ancienne, à partir des mesures de production.

Dans Aide, exporter les mesures après des tâches comparables, par rôle et appareil ; compléter la grille d’observation durée/erreurs/aide/réussite autonome. La durée d’un appel service n’est pas celle de la tâche humaine entière. Aucun taux d’abandon ou gain de productivité n’est annoncé sans observation.

La [matrice de couverture](./UX28_COVERAGE.md) distingue socle, écrans contrôlés et essais physiques. Les conventions sont dans [UI_COMPONENTS.md](./UI_COMPONENTS.md), les séances à réaliser dans [UX_VALIDATION_TERRAIN.md](./UX_VALIDATION_TERRAIN.md). Les anciennes entrées d’historique sans marqueur utilisent un secours qui protège la saisie sans garantir de retrouver tout leur ordre initial.
