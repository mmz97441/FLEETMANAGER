# Livraison UX — chauffeur, pilotage et assistance

## Décisions prises

- **UI-06** : avertissements chauffeur en ambre 800, boutons ambre 800 / orange 700 et survol jaune 800. Les indications de réserve et de colis restant sont conservées. Les boutons terrain existants conservent leur cible minimale de 44 px.
- **UI-13** : tous les panneaux de résultat, manifeste et recherche rapide utilisent `Modal`. Une opération en cours interdit la fermeture ; une création commencée demande confirmation avant abandon. Les échecs du manifeste restent visibles par colis jusqu’à leur propre reprise réussie. Un colis seulement lu n’est plus déclaré « déjà scanné » si sa prise en charge a échoué. La reprise reste donc possible.
- **UI-20** : les urgences précèdent les statistiques : immobilisation/priorité haute, arrêt échoué, preuve explicitement en attente et affectation manquante. Aucun défaut de preuve n’est inventé en se fondant sur une propriété absente. Les permissions filtrent contenu et abonnement. Les tournées du jour ne sont plus plafonnées à 100 ; les colis sont lus par leurs vrais identifiants de tournée, en groupes de dix, sans plafond de 3 000 ni dépendance à leur date d’import. Les échecs de lecture remplacent les chiffres par un message et un bouton de reprise.
- **UI-22** : un utilitaire de libellés décrit les statuts sans modifier les valeurs enregistrées. « Affectée au chauffeur » ne signifie pas « En cours » ; « Retour à remettre » ne signifie pas « Retour reçu ». Vouvoiement dans les panneaux de scan et les instructions de tournée.
- **UI-25** : brouillon avec aperçu obligatoire avant ouverture volontaire de la messagerie ; version, écran de l’erreur, heure et référence opaque optionnels. Aucun envoi automatique, pièce jointe, signature, coordonnée GPS, identifiant de colis ou URL complète. Le texte reste disponible en cas d’échec d’ouverture ; copie manuelle possible.
- **UI-27** : un diagnostic volontaire dans Aide vérifie l’accès caméra et GPS sans conserver images ni coordonnées. L’état navigateur est distingué de l’accès réel au serveur. L’étiquette CODE128 imprimable porte « TEST — AUCUN COLIS RÉEL ». Son scanner de diagnostic n’appelle aucun service métier. Une grille de huit scénarios exportable en JSON reste « Non testé » jusqu’à déclaration explicite de l’observateur.

## Limite de validation physique

Les contrôles logiciels et les captures de navigateur ne remplacent pas une séance sur les téléphones et imprimantes utilisés. Le diagnostic facilite la séance décrite dans [UX_VALIDATION_TERRAIN.md](./UX_VALIDATION_TERRAIN.md) ; il n’en fabrique pas les résultats. Exécuter les scénarios avec deux chauffeurs, un exploitant et un client sur dossiers de test autorisés, puis joindre l’export volontaire.

## Vérification logicielle

- 9 tests unitaires ciblés : priorités métier, maintien des valeurs techniques, confidentialité du contexte support et absence de résultats terrain inventés.
- Chrome local : 23 contrôles de parcours, 11 contrôles supplémentaires (dont le hook réel de statistiques avec abonnements Firestore simulés), 4 contrôles chauffeur et 2 mesures de contraste, puis 3 contrôles d’instrumentation livraison. Tous passent, sans exception JavaScript non traitée.
- Avertissement « colis non scanné » mesuré à **7,09:1** sur blanc (ambre 800), à 320 et 390 px, contre 3,19:1 lors de l’audit. Cette mesure ne prouve pas une conformité globale.
- Sur petit écran, les cinq étapes affichent des numéros ; le titre donne en clair le nom de l’étape active, sans chevauchement des libellés. Les commandes d’urgence ont une cible minimale de 44 px.
- Les incidents prioritaires ouvrent le dossier exact via son identifiant URL, avec rafraîchissement et état explicite si indisponible.
- La mesure `deliver` commence juste avant `submitDelivery`, après les contrôles et le GPS, et se termine sur son résultat réel. Elle décrit la réussite de l’enregistrement, y compris d’une tentative de livraison échouée ; ce n’est pas un taux de colis livrés. Aucune identité ni référence métier n’est collectée.
- Fixtures, scripts et captures : `audit-ux-ui-v4.25.0-2026-09-10/validation-corrections-v4.26.0/terrain/` dans le workspace. Les permissions GPS/caméra sont simulées dans ces contrôles ; la séance sur appareils réels reste non exécutée.

## Revue P1 complémentaire : ajout manuel chauffeur

Le caller chauffeur utilise désormais le journal commun `pendingManualStop` du bureau : réservation avant envoi, coordination des onglets avec Web Locks lorsque disponible, vérification de relecture et suppression limitée à la demande confirmée. La mission, le formulaire complet et le troisième argument `requestId` restent identiques après une réponse perdue. Les champs sont verrouillés tant que le résultat est incertain ; fermer conserve la demande. La reprise est disponible après rechargement, même si une autre tournée est affichée. Aucun appel n’est émis si la réservation du journal échoue.

Le test navigateur sur le véritable `DriverMissionView` simule un commit réussi puis une réponse perdue. Il recharge une autre tournée, reprend la demande et constate deux appels strictement identiques mais **un seul arrêt créé**. Huit contrôles passent, dont l’absence d’appel supplémentaire lorsque le stockage échoue. Deux tests d’adaptation chauffeur complètent les six tests du journal commun. Le statut technique `SKIPPED` garde le libellé **« Non effectué »**, sans promesse de reprogrammation.
