# Couverture UX/UI — 4.26.0

Cette matrice décrit les contrôles réellement exécutés pour les 28 recommandations. « Commun » signifie que le comportement vient du composant partagé et de ses contrôles ; cela ne remplace pas une exécution de toutes les variantes d’un écran. « NT » signifie non testé. Toutes les données de navigateur sont fictives et les services métier sont neutralisés.

## Écrans et états

| Écran / fenêtre | Nom, focus et clavier | Saisie et opérations | Chargement / erreur | Petit écran | Preuve |
|---|---|---|---|---|---|
| Bureau : éditeur d’arrêt | 9 champs nommés, focus initial, Tab/Maj+Tab, restauration | Croix/fond/Échap/Annuler, busy, valeur conservée, reprise | Adresse/durée/créneau invalides, service refusé | 320/390 px, commandes 44 px, champs 16 px | office-browser |
| Bureau : ajout manuel | Modal et champs communs | Référence/payload figés, reload, stockage, collision entre onglets | Demande incertaine visible, aucun premier envoi sans journal | Même formulaire partagé ; état de reprise contrôlé | office-browser, manual-stop-tabs, pendingManualStop.test |
| Bureau : hub | Une seule fenêtre, champs nommés, Modal commun | Confirmation du brouillon | Contrat erreur commun ; toutes les variantes édition/création NT | Composant commun ; capture détaillée NT | office-browser |
| Bureau : réordre/suppression/détail/imports | Migration Modal ; garde de fermeture commune | Transactions fraîches, refus si tournée démarrée ou colis transféré | Erreurs de services conservées ; réordre avec avertissement recalcul | Cadre commun ; chaque variante séparée NT | missionStopEditor.test, revue de code |
| Bureau : cartes, recherches et favoris | Entrée/Espace sur développement, commandes séparées | Favori sans sélection ; recherche indépendante ; tri restauré | Cinq sources en erreur, reprise et pas de faux vide | Aucun débordement à 320/390 px | office-browser, office-volume-benchmark |
| Client : création et demande incertaine | Dialogue et focus vérifiés ; champs communs | Options conservées, reprise même référence/payload, copie exacte | Réponse perdue, carnet non confirmé, reprise | 320/390 px, pied fixe | client/browser-results, pendingClientShipment.test |
| Client : portail | Recherche nommée ; listes lisibles | Consultation sans écriture ; invitation false puis succès | GPS avant colis, erreur de source, liste refusée puis relance | 320/390 px | clientPackageSubscription.test, client/browser-results |
| Client : aperçu et intervention | Acteur/client visibles dans l’en-tête fixe et imbriqué | Consultation, audit refusé, activation, écriture auditée, retour consultation | Audit initial refusé = zéro mutation ; audit final refusé ne rejoue pas succès | 320/390 px ; compte/expédition imbriqués à 390 px | clientMutation.test, clientInterventionService.test, client/nested-browser-results |
| Client : carnet/imports/compte | Cadre partagé ; variants individuels focus/clavier NT | Gardes readOnly et audit propagées ; compte imbriqué testé | Échecs propagés aux messages existants | Compte imbriqué contrôlé ; chaque import séparé NT | revue, client/nested-browser-results |
| QuickScan : résultats/manifeste/création | Modal commun ; clavier et contexte dans la fixture | Fermeture protégée, prise en charge refusée rescannable, erreur par colis | Réseau refusé, busy, reprise ciblée | 320/390 px pour variantes de fixture | terrain/browser-results, terrain/extra-results |
| Chauffeur : livraison | Progression numérotée, titre d’étape lisible | Mesure autour de submitDelivery sur succès/échec | Alerte colis non scanné, résultat réel instrumenté | 320/390 px ; contraste 7,09:1 ; commandes 44 px | terrain/driver-contrast-results, terrain/delivery-metrics-results |
| Chauffeur : ajout manuel | Formulaire commun et contexte de reprise | Payload figé, réponse perdue puis reload et même requête | Blocage si journal impossible, erreur réessayable | Fixture réelle du composant | terrain/manual-stop-recovery-results |
| Tableau de bord / incident | Actions nommées et permission filtrée | Ouverture de la bonne tournée ou du dossier incident | Sources en erreur, retry, incident inconnu ou mis à jour | Fixture mobile et bureau ; usages humains NT | operationalQueue.test, terrain/extra-results |
| Aide : support | Dialogue avec aperçu, actions explicites | Aucune transmission automatique ; copie volontaire | Contexte facultatif et référence opaque | 320/390 px | supportContext.test, terrain/browser-results |
| Aide : diagnostic | Commandes volontaires, résultats explicites | Caméra arrêtée à fermeture ; pas de mutation métier | Refus caméra/GPS simulé ; grille initialement NT | 320/390 px | terrain/browser-results ; appareils physiques NT |
| Application : navigation | Confirmation au focus interne | Retour annulé/accepté, Avancer, menu, busy, reload, brouillons imbriqués | Envoi en cours conserve l’écran | Confirmation 390 px | navigationGuard.test, navigation-browser, client/navigation-browser-results |
| GPS/Documents obligatoires | Modal commun | preventClose séparé de busy, sortie Documents gardée | Aucun état occupé fictif | Diagnostic physique NT | revue des propriétés, typecheck |

## Régressions et périmètre des preuves

Les tests `src/**/*.test.ts` s’exécutent avec `npm test`. Les nouveaux tests couvrent notamment la navigation et son historique après rechargement, les journaux de reprise, la validation d’arrêt, les transactions d’arrêt, l’attente des sources client, l’audit des interventions, les références exactes, les favoris, le support et les métriques. Les suites émulateurs complètent ce contrôle avec règles, Storage, services serveur et cycle de livraison.

Les résultats compacts sont conservés dans `docs/validation/ux28/`. Les captures, fixtures et sondes complètes se trouvent dans le workspace :

- `validation-ux28-bureau/` : bureau, benchmark et contrôle entre onglets.
- `validation-ux28-release-4.26.0/` : navigation commune, tests, audits et vérification de publication.
- `audit-ux-ui-v4.25.0-2026-09-10/validation-corrections-v4.26.0/client/` : client, intervention imbriquée et reload.
- `audit-ux-ui-v4.25.0-2026-09-10/validation-corrections-v4.26.0/terrain/` : chauffeur, scanner, tableau de bord, assistance et diagnostics.

La revue visuelle a contrôlé les captures des cartes bureau, de la création client et du parcours chauffeur à 320/390 px. Les contrôles Chrome ne sont pas des essais VoiceOver/TalkBack, Safari iOS ou impression physique. Une conformité globale d’accessibilité et une validation exhaustive de toutes les fenêtres de l’application ne sont pas revendiquées.

## Validation physique et mesures humaines

UI-27 demeure **à exécuter sur appareils**. Dans Aide, le diagnostic et la grille exportable facilitent les séances du [protocole terrain](./UX_VALIDATION_TERRAIN.md). Il faut deux chauffeurs, un exploitant et un client ; les statuts restent NT jusqu’à observation explicite. Le scan extérieur, la veille/reprise, le réseau coupé, le clavier système, la signature et les imprimantes doivent être consignés séparément.

L’identification des trois urgences en moins de dix secondes et les gains d’usage avant/après UI-20/28 nécessitent une observation humaine. Les mesures techniques livrées ne les remplacent pas. Les mesures de volumétrie UI-21 sont synthétiques ; le coût et les temps Firestore réels restent à relever en exploitation.
