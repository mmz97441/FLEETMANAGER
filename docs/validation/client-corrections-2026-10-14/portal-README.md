# Recette du portail client — 14 octobre 2026

Résultat final : **65 assertions réussies, aucune échouée, aucune exception navigateur**. Le détail machine est dans [portal-browser.json](portal-browser.json). Les écrans ont été testés à **320, 390 et 1440 px**, dans Chrome avec un profil temporaire et le fuseau **Europe/Paris**, pour vérifier que les heures métier restent celles de La Réunion.

## Périmètre et résultats

| Parcours | Résultat vérifié |
| --- | --- |
| Groupement | Dix colis pour une pharmacie (neuf livrés, un absent à l’enlèvement) restent visibles après ouverture d’un suivi. Le groupe garde son statut partiel. Un autre destinataire à la même adresse forme un groupe distinct. |
| Recherche | La saisie de la référence client en 18 frappes déclenche exactement un chargement complet d’historique et conserve le groupe de dix colis. L’ouverture d’un détail active également son suivi dédié. |
| Offre | Le dialogue présente le montant, le trajet, la date et l’heure Réunion, les conditions et le créneau. Une mise à jour distante du prix laisse le dialogue initial figé ; la confirmation transmet ce snapshot initial et l’erreur de changement d’offre reste visible. |
| Profil | Une erreur d’enregistrement garde la saisie modifiable et ne présente pas de succès. |
| Consultation | Les créations, imports, demandes d’intervention et modifications du profil sont désactivés ; l’acceptation d’offre est absente. Aucun appel de mutation n’a lieu. |
| Carnet et création | La sélection préremplit ville, code postal, contact et consignes. Les consignes peuvent être effacées pour cet envoi sans changer celles du carnet. |
| Dates du devis | À une heure synthétique de 15 h 30 Réunion, le minimum d’enlèvement est le lendemain à 08 h 00. Une date passée est invalide. Une collecte à 08 h 00 autorise la livraison à partir de 11 h 00. |
| Import XLSX | Un vrai classeur de 77 lignes produit 76 lignes valides et une adresse incomplète rejetée. Une colonne inconnue est signalée. Les dates propres aux lignes, le créneau, la durée de 10 minutes et l’étage 0 sont transmis. |
| Reprise d’import | Après 75 confirmations puis une confirmation réseau perdue, l’écran distingue 75 lignes confirmées et une inconnue. La reprise transmet uniquement cette dernière référence ; le bilan final affiche 76 confirmées et une rejetée, sans doublon dans le stockage simulé. |
| Affichage | Absence de débordement horizontal sur les listes, détails, confirmation, profil, consultation et création aux trois largeurs, ainsi que sur le bilan d’import mobile. |

Captures représentatives : [offre sur 320 px](portal-offer-conditions-320.png), [erreur de prix sur 390 px](portal-offer-changed-390.png), [profil conservé](portal-profile-failure-390.png), [consignes du carnet](portal-saved-instructions-390.png), [import interrompu](portal-import-interrupted-390.png), [bilan de reprise](portal-import-resumed-390.png). Toutes les captures sont référencées dans le JSON.

## Reproduction

Depuis la racine du dépôt, dans deux terminaux :

```sh
node scripts/client-portal-fixture.mjs
```

```sh
node scripts/client-portal-probe.mjs
```

La fixture écoute uniquement `127.0.0.1:5259`. Le second script lance et ferme son propre Chrome et son profil temporaire. Le chemin Chrome peut être fourni avec `CHROME_PATH`. Les captures et le JSON sont réécrits dans ce répertoire. Arrêter la fixture avec Ctrl-C après la recette.

## Limites

Les composants `ClientPortal`, `ClientShipments`, `CreateShipmentModal`, `ImportShipmentsModal` et `PackageTimeline`, leurs formulaires et le parseur XLSX sont réels. Les services réseau, la réponse métier « offre modifiée », les reçus d’import et l’échec du profil sont simulés à leurs frontières. Les vues lourdes hors périmètre sont remplacées par des composants vides. Les endpoints Firebase externes sont bloqués et les données sont entièrement synthétiques : aucune écriture de production ou d’émulateur n’est effectuée. Cette recette établit le comportement de l’interface ; la validation des transactions et des autorisations serveur relève des suites émulateur séparées.

Vérification visuelle effectuée sur la confirmation 320 px et le bilan d’import 390 px. Les autres captures complètent les assertions DOM ; ceci ne remplace pas un essai sur téléphone physique et lecteur d’écran.
