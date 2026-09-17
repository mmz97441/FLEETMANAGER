# Diagnostic de simplification — FleetGenius / Delivrex

Date : 17 septembre 2026. Cible : une personne peu à l’aise avec le numérique doit pouvoir comprendre sa prochaine action sans formation informatique.

## Avis clair

L’application possède les fonctions nécessaires et plusieurs améliorations utiles sont déjà présentes : menu chauffeur réduit, étapes de livraison, filtres repliables, champs facultatifs masqués, protections des brouillons, confirmations et reprise des envois. Il faut les conserver.

**Elle demande encore trop souvent à l’utilisateur de comprendre son organisation interne.** Préparer une tournée, consulter des colis, suivre des chauffeurs et traiter les exceptions se répartissent entre plusieurs écrans. Le même compte ou la même information peut se retrouver à plusieurs endroits. Ajouter des couleurs ou agrandir les boutons ne résoudra pas ces hésitations.

La prochaine amélioration doit privilégier des parcours : « Que dois-je faire maintenant ? », « Est-ce enregistré ? », « Comment corriger une erreur ? ». Les réglages avancés restent disponibles pour les personnes autorisées, à distance du travail quotidien.

L’objectif « aussi simple pour un enfant de 10 ans que pour une personne de 65 ans » est un objectif de compréhension, pas un changement des droits d’accès ni une garantie liée à l’âge. Une livraison professionnelle, une signature ou une autorisation restent des actes réservés aux utilisateurs habilités.

## Périmètre et niveau de preuve

- Inventaire des **41 routes** déclarées dans `src/routes.ts`, de leur rendu dans `src/App.tsx`, des menus et des composants concernés. Les écrans de connexion, les formulaires et fenêtres importants sont également recensés ci-dessous.
- Diagnostic fondé sur la lecture des interfaces, de leurs états et des logiques de navigation. Les références renvoient aux fichiers sources : il ne s’agit pas de constats inventés sur une session utilisateur.
- Essais navigateur réalisés dans cette intervention sur le parcours de scan, avec services simulés, aux largeurs 320, 390 et 1365 px. Les tests métier des scans sont distincts et tournent sur Firebase local.
- **Les 41 pages n’ont pas toutes été retestées visuellement ni confiées à des débutants pendant cette intervention.** Les difficultés d’usage ci-dessous sont des risques et recommandations à valider, pas des taux d’échec mesurés.
- Ce document propose une prochaine évolution. Il ne prétend pas que toute cette refonte est déjà implémentée.

## Décisions de conception recommandées

1. **Une action principale par situation.** Les autres vont dans « Autres actions », avec leur nom complet. « Livrer » ne doit pas rivaliser avec une exportation, une optimisation ou une modification de tournée.
2. **Une information a un domicile principal.** On peut y accéder depuis plusieurs raccourcis, mais on retrouve la même fiche et le même historique.
3. **Des mots concrets et stables.** Tournée, colis, dépôt, destinataire, chauffeur. Expliquer « Envoi en attente de connexion » avant d’exposer un terme technique.
4. **Préremplir ce qui est certain.** Chauffeur connecté, date de travail, véhicule affecté, destinataire enregistré. Demander une vérification lorsque plusieurs choix métier sont réellement possibles.
5. **Montrer l’essentiel, déplier les détails.** La fiche colis commence par son état, sa tournée datée et la prochaine action ; l’identifiant technique et le journal complet restent accessibles.
6. **Une réussite décrit ce qui a réellement été enregistré.** Une lecture de code, une demande envoyée et une confirmation serveur sont trois états distincts. Même règle pour une livraison ou un import.
7. **Des erreurs qui disent quoi faire.** Exemple : « Ce colis n’est pas reconnu. Vérifiez le numéro sur l’étiquette », avec « Réessayer » et une aide ciblée. Le détail technique est copiable depuis une rubrique séparée.
8. **Des commandes lisibles et faciles à toucher.** Viser 16 px pour le texte courant et 48 px pour les actions terrain ; éviter un contenu indispensable tronqué, une icône sans texte et une signification donnée uniquement par la couleur. Ce sont des objectifs de design à vérifier au navigateur, pas une certification d’accessibilité.

## Priorités

**P1 — prochaine livraison UX :** parcours chauffeur unique, suivi de confirmation, fiche colis commune, création d’expédition guidée, fusion des accès redondants au compte, retrait des entrées sans action utile.

**P2 — livraison suivante :** préparation bureau centrée sur les exceptions, formulaires véhicule/carburant/incident, imports avec correction guidée, paramètres exprimés en conséquences métier.

**P3 — après mesure des usages :** consolidation des cartes et tableaux de bord, présentation des statistiques et des outils d’administration.

## Diagnostic des 41 pages

« À conserver » désigne les règles métier, droits ou protections qui doivent survivre à la simplification.

| # | Page / route | Simplification recommandée et raison | À conserver | Priorité |
|---|---|---|---|---|
| 1 | Accueil `/` | Garder la file « À traiter maintenant » déjà présente ; pour le chauffeur, mettre la prochaine action avant consommation et statistiques. Pour le bureau, remonter les exceptions plutôt que toutes les cartes. | Différences par rôle, période des chiffres, accès au détail. | P1 |
| 2 | Véhicules `/vehicles` | Un chauffeur arrive directement sur son véhicule ; le bureau garde la liste. Présenter disponibilité et prochaine échéance avant les caractéristiques. | Affectation unique, autorisations d’édition, historique. | P2 |
| 3 | Chauffeurs `/drivers` | Séparer visuellement « disponible aujourd’hui » et « informations du compte ». Un seul bouton « Voir le chauffeur » ouvre la fiche complète. | Absences, véhicule affecté, confidentialité des données RH. | P2 |
| 4 | Carburant `/fuel` | Parcours court « Mon véhicule → kilomètres du compteur → litres et montant → justificatif ». Préremplir le véhicule ; analyses dans une vue bureau séparée. | Contrôles de kilométrage, unités, montants, justificatif et correction tracée. | P2 |
| 5 | Maintenance `/maintenance` | Le titre « Saisir Facture / Maintenance » mélange deux intentions. Proposer « Signaler un entretien effectué », puis « Ajouter la facture » dans le dossier. | Coûts, dates, prestataire, pièces justificatives, droits. | P2 |
| 6 | Incidents `/issues` | Commencer par « Quel problème ? » et « Le véhicule peut-il rouler ? ». Proposer une photo, puis les détails. Garder l’analyse et la résolution pour le bureau. | Gravité, affectation, preuve, historique de résolution. | P1 |
| 7 | Utilisateurs `/users` | Action principale « Inviter une personne ». Rôle en langage courant avec résumé des accès. Déplacer le nettoyage des doublons dans les outils avancés. | Invitations sécurisées, désactivation, séparation des rôles, traçabilité. | P2 |
| 8 | Permissions `/permissions` | Présenter des profils de travail compréhensibles ; exceptions individuelles repliées avec résumé « accès ajoutés / retirés ». | Contrôle serveur, droits effectifs, interdiction d’escalade. | P2 |
| 9 | Aide `/help` | La recherche et les rubriques existent : ajouter d’abord les problèmes du contexte courant, avec bouton vers la bonne action. Réduire le besoin de parcourir un long guide. | Diagnostic volontaire, contact d’assistance, données techniques séparées. | P1 |
| 10 | Carte des véhicules `/map` | La distinguer de la carte des chauffeurs par un sélecteur « Véhicules / Chauffeurs » dans un espace commun. Aucun deuxième menu nécessaire pour la même intention « Où est… ? ». | Source et âge de la position, accès limités, sélection de véhicule. | P3 |
| 11 | Assistant `/ai` | Proposer des questions concrètes plutôt qu’un champ entièrement libre comme seul point de départ. Montrer les données utilisées et la période. | Aucun changement opérationnel implicite ; contrôle humain des suggestions. | P3 |
| 12 | Mes documents `/documents` | Deux groupes « À lire ou signer » et « Déjà consultés ». Une lecture puis une signature explicite, avec un reçu clair. | Contenu/version, consentement, identité, preuve de signature. | P2 |
| 13 | Documents entreprise `/company-docs` | Une fiche document avec destinataires et état des signatures ; publication guidée « document → personnes → vérifier → publier ». | Versionnement, habilitations, conservation des accusés. | P2 |
| 14 | Congés `/leaves` | Réunir avec les absences sous une même entrée, avec « Demander des congés » comme raccourci. Les deux pages rendent déjà `AbsenceManager`. | Solde, calendrier, validation par une autre personne, remboursement correct. | P1 |
| 15 | Absences `/absences` | Même espace que les congés ; les choix de motif déterminent les champs. Éviter d’imposer les catégories RH et leurs sigles dès l’entrée. | Justificatifs, visibilité restreinte, distinction demande/décision. | P1 |
| 16 | Devis `/quotes` | Conserver la présentation liste/détail déjà adaptée au mobile ; distinguer trois actions : préparer l’offre, vérifier, envoyer. Prix et destinataire visibles avant envoi. | Validation du prix, accord du client, création de commande unique. | P2 |
| 17 | Mon compte `/settings` | Rassembler profil et sécurité dans un domicile unique. Afficher seulement les préférences réellement disponibles. | Réauthentification si nécessaire, validations, brouillon protégé. | P1 |
| 18 | Réglages entreprise `/company-settings` | L’écran indique actuellement que la modification n’est pas disponible. Supprimer son entrée normale, ou afficher une vraie demande de changement avec suite explicite. | Identité légale et responsabilité de sa modification. | P1 |
| 19 | Journal `/activity-logs` | Recherche métier « colis / chauffeur / date », puis histoire ordonnée. Les métadonnées brutes restent dépliables. Ajouter un filtre « Scans » avec résultat et tournée. | Journal immuable et accès président ; aucun élargissement de droits. | P2 |
| 20 | Erreurs `/error-logs` | C’est le même composant que le journal avec l’onglet erreurs. Garder un seul espace, distinguer « À examiner » et « Détails techniques ». | Données techniques originales, contexte, accès confidentiel. | P2 |
| 21 | Direction `/vue-de-dieu` | Le menu dit « Vue d’ensemble direction », mais le titre affiche encore « Vue de dieu ». Harmoniser le vocabulaire et expliquer le dénominateur des indicateurs. | Périmètre temporel et distinction livré / échec / en cours. | P2 |
| 22 | Carte chauffeurs `/carte-chauffeurs` | Garder la légende et la position ancienne déjà présentes. Ajouter une liste de secours utile avant le chargement de la carte et un lien direct vers la tournée. | Pas de fausse localisation en direct ; âge de la position visible. | P2 |
| 23 | Suivi tournées `/suivi-tournees` | Trois vues immédiates : « En cours », « Besoin d’aide », « Terminées ». Une ligne montre chauffeur, progression et prochaine difficulté. | Détail des colis, arrêts échoués, preuve avant clôture. | P1 |
| 24 | Suivi client `/client/suivi` | Commencer par le colis recherché et son état ; la carte vient ensuite. Expliquer « position reçue à… » et les limites de l’heure estimée. | Isolation entre clients, preuve et événements réels, position périmée identifiable. | P1 |
| 25 | Préparer les tournées `/missions` | Organiser les six onglets autour de trois tâches « Préparer », « Suivre », « Retrouver un colis ». Garder imports et dépôts accessibles dans leur contexte. Voir détail ci-dessous. | Affectation cohérente, capacité, disponibilité, contrôles des adresses. | P1 |
| 26 | Notifications `/notifications-settings` | Cet écran dit que les réglages ne sont pas configurables. Retirer l’accès ordinaire tant qu’aucune préférence n’est effective. La cloche reste le domicile des messages reçus. | Réception et accès aux alertes existantes. | P1 |
| 27 | Diagnostic `/api-diagnostic` | Déplacer dans « Assistance → Diagnostic avancé ». Présenter d’abord « Service disponible / indisponible » et « Copier le diagnostic ». | Aucune clé exposée ; tests sans effet métier. | P2 |
| 28 | Horaires `/delivery-schedule` | Montrer une semaine et un exemple de résultat avant les tableaux avancés. Expliquer « sans limite » en toutes lettres au lieu d’un symbole seul. | Créneaux, capacité, jours fériés, zones, validation avant enregistrement. | P2 |
| 29 | Zones `/zone-management` | Recherche par commune ou code postal ; afficher directement la zone trouvée. Ajouter un aperçu avant de charger les valeurs par défaut. | Unicité des correspondances, contrôle des changements, confirmation des suppressions. | P2 |
| 30 | Réception et chargement `/hub-operations` | Deux intentions clairement séparées : « Je reçois au dépôt » et « Je charge pour un chauffeur ». Contexte choisi une fois, puis scan et résultat lisible. | Une réception ne signifie pas départ en livraison ; rattachement et traçabilité du chargement. | P1 |
| 31 | Ma tournée `/driver-tour` | Écran centré sur « Prochain arrêt », avec l’action nécessaire selon l’état. Historique, optimisation et réorganisation derrière « Plus ». Montrer le nombre restant sans surcharge. | Bon colis / bon arrêt, preuves, réserves, échecs, synchronisation et clôture contrôlée. | P1 |
| 32 | Aperçu chauffeur `/driver-preview` | Retirer cette entrée du travail courant. Faire de l’aperçu une démonstration clairement identifiée, sans prise en charge réelle au nom d’un administrateur. | Aucun contournement des droits ni faux chauffeur opérationnel. | P1 |
| 33 | Import/export `/import-export` | L’écran redirige déjà vers les imports. Conserver le lien historique pour compatibilité ; un seul accès visible depuis « Préparer ». | Import vérifié, réessai sans doublon et rapport de résultat. | P2 |
| 34 | Accueil client `/client` | Les raccourcis « Que voulez-vous faire ? » existent. Prioriser « Envoyer un colis » et « Retrouver un colis », puis les envois en difficulté. | Guide de démarrage contextuel, droits d’écriture, résultat d’enregistrement. | P1 |
| 35 | Devis client `/client/requests` | Libellé identique partout « Mes devis ». Expliquer la différence entre demande envoyée, offre à accepter et expédition créée. | Acceptation explicite, prix annoncé, création unique de commande. | P2 |
| 36 | Équipe client `/client/team` | La gestion existe aussi dans l’entreprise et le compte. Unifier dans « Mon entreprise → Équipe » ; garder les anciens liens comme raccourcis. | Invitations, rôle du membre, isolement de l’entreprise. | P1 |
| 37 | Mes colis `/client/shipments` | Recherche principale par numéro ou destinataire, filtres simples, fiche unique avec « Où en est-il ? ». Imports et exports dans les actions secondaires déjà repliables. | Références uniques, statuts détaillés accessibles, BL et preuve, création idempotente. | P1 |
| 38 | Statistiques client `/client/statistiques` | Trois réponses principales : volume, réussite, délai. Déplier les graphiques et expliquer le calcul au bon endroit. Éviter « Top pharmacies » pour un client d’un autre secteur. | Période, données manquantes explicites, définitions et confidentialité. | P3 |
| 39 | Destinataires `/client/destinataires` | Rechercher ou choisir une fiche avant de ressaisir. Proposer de corriger une adresse enregistrée depuis l’expédition, avec portée du changement expliquée. | Téléphone et adresse valides, distinction fiche contact / envoi déjà créé. | P2 |
| 40 | Entreprise client `/client/entreprise` | Conserver un seul formulaire d’identité et une seule équipe, partagés avec « Mon compte ». Expliquer qui peut modifier le nom de société et comment demander la correction. | Identité expéditeur, données légales, contrôle d’accès. | P1 |
| 41 | Aide client `/client/aide` | Les liens directs depuis les guides existent. Prioriser « Je veux envoyer », « Je cherche un colis », « J’ai un problème » ; nouvelles fonctionnalités en second plan. | Accès à l’assistance, guides complets disponibles, aperçu client sans mutation. | P2 |

## Formulaires et parcours à simplifier dans ces pages

| Écran / composant | Proposition concrète | Limite métier à respecter |
|---|---|---|
| Connexion — `Login` | Conserver email, mot de passe visible à la demande et récupération. Afficher un seul message utile après erreur et une assistance clairement accessible. | Ne pas divulguer l’existence d’un compte. |
| Activation — `ActivateAccount` | Présenter qui invite, pour quelle entreprise, puis « Choisir mon mot de passe ». Lien expiré : une suite explicite, sans jargon. | Invitation non réutilisable et rôle imposé par le serveur. |
| Scan — `ClaimScanModal`, `Scanner` | Correction actuelle : confirmation immédiate après serveur, doublon distinct, date et tournée, reprise réseau. Prochaine simplification : « Scanner pour ma tournée » puis un bilan court, détails dépliables. | Pas de faux succès hors connexion ; pas de colis inventé lors d’une panne réseau. |
| Fiche colis — `PackageScanInfo`, `PackageTimeline`, fiches bureau/client | Un résumé commun : numéro, état, tournée datée, dernier scan, prochaine action. Timeline sous « Historique ». Adapter les détails au rôle. | Garder l’ancienne tournée et les preuves ; ne pas inventer les heures historiques manquantes. |
| Livraison — `DriverMissionView` | Maintenir l’assistant existant mais afficher une seule étape dominante : vérifier les colis, remettre, ajouter la preuve, confirmer. « Impossible de livrer » reste disponible. | Aucune signature précochée, aucune preuve réutilisée, réserves et remise partielle conservées. |
| Enlèvement — `PickupScanView` | Compteur « 3 sur 5 » avec liste des deux manquants ; bilan avant signature. Expliquer à qui revient le colis à cette étape. | Les manquants ne deviennent pas collectés ; scan distinct de la validation de collecte. |
| Envois en attente — `PendingSyncBanner` | « 2 livraisons à envoyer » puis liste et action « Réessayer ». Distinguer enregistré sur ce téléphone et reçu par le serveur. | Photos et signatures conservées ; aucune clôture tant que les preuves nécessaires manquent. |
| Préparation — `MissionManager`, onglet accueil | Remonter la prochaine tâche et les anomalies. Éviter un second tableau de bord général. | Sources non chargées jamais assimilées à zéro. |
| Affectation — `DispatchManager` | Les trois étapes existent déjà : les conserver, préremplir les choix fiables et rendre le bilan final plus explicite : affectés, exclus, raison. | Capacités, disponibilités, contraintes horaires, adresses et confirmation atomique. |
| Import bureau — `ImportReviewTable` | Afficher d’abord les lignes à corriger, avec « Problème → valeur attendue → modifier ». Les données valides restent consultables. | Aucun rejet silencieux, aucun doublon au réessai ; bilan exact. |
| Colis et tournées — onglets `MissionManager` | Recherche de colis en accès direct, avec contexte de date visible. Une navigation depuis une alerte ouvre la bonne fiche sans obliger à refaire les filtres. | Permissions, filtres actifs affichés et appartenance actuelle vérifiée. |
| Dépôts — onglet hubs | Mettre leur gestion dans les réglages opérationnels ; afficher seulement le dépôt utile pendant une réception. | Dépôt actif et cohérence de réception. |
| Création — `CreateShipmentModal` | Les champs facultatifs sont déjà repliés. Ajouter un enchaînement court destinataire → colis/date → vérifier ; proposer d’abord le carnet d’adresses. | Date valable, adresse complète, numéro distinct par carton, création unique et impression séparée. |
| Import client — `ImportShipmentsModal`, `ImportRecipientsModal` | Un bouton « Importer un fichier » demande ensuite « Des expéditions / Des destinataires ». Fournir un exemple adapté à ce choix. | Importer un carnet ne crée pas automatiquement des expéditions. |
| Étiquettes / BL / preuve — `ShippingLabel`, `PODViewer` | Utiliser les noms complets « Étiquette du colis », « Bon de livraison », « Preuve de remise », avec un aperçu avant impression. | Code unique et lisible, document du bon colis et destinataire, impression sans nouvelle création. |
| Notifications — `NotificationCenter` | Regrouper par objet ; titre orienté action et bouton ouvrant le bon dossier. Les nouvelles notifications ne doivent pas déplacer un écran en cours. | Marquer lu ne valide aucune action métier ; distinction priorité / simple information. |
| Mon compte — `AccountHub` et `Settings` | Partager les mêmes sous-écrans plutôt que multiplier les formulaires de profil, entreprise et équipe. | Pas de perte de saisie en changeant d’onglet ; mot de passe réservé au titulaire. |
| Détail véhicule — `VehicleDetail` | Présenter état, chauffeur et échéance avant « Métriques ». Historique et export dans « Détails ». | Kilométrages et coûts originaux restent consultables. |
| Diagnostic téléphone — `DeviceDiagnostics` | « Tester la caméra », « Tester la connexion », « Copier le résultat ». Le résultat indique la prochaine action recommandée. | Le test caméra ne charge aucun colis réel. |

## Trois parcours cibles

**Chauffeur :** ouvrir « Ma tournée » → scanner les colis → lire « Colis ajouté à la tournée du … » → « Aller au prochain arrêt » → vérifier les colis à remettre → recueillir la preuve → lire « Livraison enregistrée ». Un problème de réseau affiche explicitement « Conservée sur ce téléphone, envoi en attente » si la conservation locale a réellement réussi.

**Client occasionnel :** « Envoyer un colis » → choisir un destinataire → nombre de cartons et jour souhaité → vérifier le récapitulatif → créer → imprimer l’étiquette. La réimpression et la reprise après erreur ne créent jamais un nouvel envoi.

**Bureau :** « À préparer » → vérifier l’import et ses erreurs → choisir les chauffeurs disponibles → vérifier les tournées proposées → confirmer → suivre les exceptions. Le nombre de colis exclus et la raison restent visibles jusqu’à leur traitement.

## Ce qui ne doit pas être simplifié par suppression

La simplicité se joue dans la présentation, pas dans la disparition des contrôles. À conserver : accès par rôle, séparation entre entreprises, doublons, affectation unique du colis, dates de tournée, preuve de remise, réserves, retours, signatures, événements datés, reprise après interruption et protection des brouillons. Les actions destructives ou engageantes gardent une confirmation contextualisée ; les actions réversibles ordinaires ne nécessitent pas une suite de confirmations.

Un libellé public plus simple peut regrouper la lecture des états (« À préparer », « Avec le chauffeur », « Livré », « À traiter »), **sans fusionner les statuts du système**. « À retourner », « Échec » et « Retourné » doivent rester distinguables lorsqu’une décision est à prendre.

## Vérification avec des utilisateurs peu expérimentés

Faire essayer une première version à des adultes volontaires de niveaux variés, notamment des personnes peu habituées aux applications et de plus de 60 ans. Ne pas supposer qu’un âge prédit le niveau numérique. Utiliser des colis et signatures fictifs, jamais une mission réelle.

Tâches : se connecter ; retrouver sa tournée ; scanner deux fois ; reprendre un colis de la veille ; retrouver sa date de scan ; livrer avec un colis manquant ; comprendre un envoi en attente ; créer puis réimprimer une expédition ; signaler un incident ; retrouver un document à signer.

Critères proposés, à mesurer plutôt qu’à annoncer comme déjà atteints :

- Au moins 9 personnes sur 10 accomplissent les tâches courantes sans indication de l’observateur.
- Aucune personne ne confond « code lu » et « opération enregistrée », ni « signature saisie » et « preuve envoyée ».
- Chacun peut expliquer à quelle tournée appartient un colis et de quel jour il s’agit.
- Aucun doublon, aucune perte de preuve ou modification d’une autre entreprise pendant les essais.
- Une erreur laisse une sortie claire : corriger, réessayer ou contacter une aide avec le contexte.

Mesurer les demandes d’aide, retours en arrière, erreurs et abandons avant/après. Le temps de réalisation est secondaire par rapport à la bonne décision métier.

## Références du diagnostic

- Navigation : [routes](../../src/routes.ts), [rendu des pages](../../src/App.tsx), [menus](../../src/components/Sidebar.tsx).
- Chauffeur et bureau : [tournée](../../src/components/DriverMissionView.tsx), [exploitation](../../src/components/MissionManager.tsx), [préparation](../../src/components/DispatchManager.tsx), [dépôt](../../src/components/HubOperations.tsx).
- Client : [portail](../../src/components/ClientPortal.tsx), [création](../../src/components/CreateShipmentModal.tsx), [compte](../../src/components/AccountHub.tsx), [statistiques](../../src/components/ClientAnalytics.tsx).
- Preuves de validation du scan : [tests navigateur](../validation/scans/browser.json), [tests métier](../../scripts/test-scan-package.cjs), [tests de reprise réseau](../../src/services/scanService.test.ts).

## Repères méthodologiques

Les choix de libellés communs s’appuient sur les explications du W3C concernant l’[identification cohérente des fonctions](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html). La réduction de l’effort de compréhension suit les recommandations complémentaires sur l’[utilisabilité pour les personnes ayant des difficultés cognitives](https://www.w3.org/TR/coga-usable/). Les dimensions de boutons proposées ici sont des objectifs de confort ; le [critère WCAG sur les cibles tactiles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) possède son propre seuil et ses exceptions. Ces références ne constituent pas une déclaration de conformité de l’application.
