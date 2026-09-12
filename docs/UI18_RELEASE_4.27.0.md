# Livraison UI 4.27.0 — les 18 corrections

La version 4.27.0 applique les 18 axes de l’avis UI du 12 septembre 2026 à partir de la version 4.26.0 (`1facefb368c2d73a0ee951f4cdd71115579c95cd`). Trois lots ont été confiés aux agents client, bureau et terrain. L’orchestrateur a intégré les contrats partagés, relu les modifications et les captures, exécuté les vérifications transversales et préparé la livraison. La revue croisée du socle a aussi corrigé le singulier des compteurs et le respect de la taille des grands boutons.

## Décisions prises et couverture

| Point | Décision appliquée | Preuve principale |
|---|---|---|
| **1. Priorité dans les colis** | Destinataire, adresse complète et statut passent avant le code. Une référence longue est annoncée comme abrégée ; « Voir en entier » et un champ sélectionnable donnent la valeur complète. Copie, partage et recherche utilisent toujours la référence exacte. | Portail et clavier client, noms/adresses/codes longs aux trois largeurs. |
| **2. Densité mobile** | Recherche et contexte courant restent visibles. Outils, imports, étiquettes et vues enregistrées se regroupent dans des sections secondaires. Les actions gardent leurs cibles tactiles. | Comparaisons géométriques client et bureau, captures avant/après. |
| **3. Hiérarchie des commandes** | Bleu de marque pour l’action principale ; blanc pour l’alternative ; rouge pour l’action destructive ; variante discrète pour les commandes secondaires. Les états désactivé, occupé et focus sont explicites. | Galerie de contrats, contrôles clavier, tailles et contrastes calculés. |
| **4. Palette et en-têtes** | `PageHeader` partagé, titre entier sur mobile, palette de marque commune à la connexion, au portail et aux aides. Le grand en-tête violet de l’aide est retiré. | Captures client, aide, bureau et tableau de bord. |
| **5. Lisibilité** | Données secondaires utiles à 14 px, informations principales et champs mobiles à 16 px. Seules les versions techniques du pied de navigation et de connexion restent plus petites, avec exception documentée. | Styles calculés et contrôle statique sur le périmètre des 44 fichiers. |
| **6. Surfaces** | Une surface par groupe, séparateurs pour les sous-parties ; retrait des médaillons et fonds décoratifs concurrents. La liste chauffeur de colis pendant le scan devient une checklist unique. | Captures chauffeur, création, aide et indicateurs ; handlers terrain comparés à 4.26. |
| **7. Filtres client** | Les cinq grandes cartes deviennent une commande « Statut » sur téléphone et des boutons de filtre explicites au bureau, avec quantité et sélection lisibles. | Filtrage et recherche testés ; plus de grande carte « Tous » isolée. |
| **8. Tableaux** | Contrat commun pour en-têtes, cellules, nombres et sélection ; tableaux de colis et véhicules harmonisés. Les véhicules ont des cartes mobiles qui conservent informations et commandes. La pagination et les vues enregistrées restent disponibles. | Tableaux desktop, cartes mobiles, contrôles bureau et galerie partagée. |
| **9. Informations longues** | Adresses, trajets et descriptions reviennent à la ligne ; retrait des limites de 80 px dans les devis. Le détail reste accessible au toucher et au clavier. | Devis, dispatch, véhicules et destinataires avec données longues. |
| **10. Formulaires mobiles** | Longs formulaires en plein écran mobile, corps défilant, en-tête compact et actions finales dans le pied de fenêtre lorsque nécessaire. Protections de saisie, envoi et fenêtres imbriquées conservées. | Viewports courts 390×420 et 320×568, Échap, focus, fermeture et reprises. |
| **11. Intervention client** | Client cible et intervenant figurent dans l’en-tête fixe ; les détails d’identité sont repliables. Le mode consultation/intervention reste annoncé, y compris dans les sous-formulaires. | Identités longues, défilement, fenêtre imbriquée et soumission forcée en lecture seule. |
| **12. Résultats et erreurs secondaires** | Résultat métier d’abord, prochaine action ensuite : impression puis consultation des colis. Erreurs du carnet, du journal ou de l’impression restent distinctes du succès de création. Le bilan d’un devis conserve séparément le résultat de chaque adresse. | Échec carnet, popup d’impression bloquée, reprise et réimpression sans nouvelle création. |
| **13. Compteurs et gravité** | Quantités neutres et fixes, valeur exacte accessible derrière `99+`. Notifications « Prioritaire » et « Urgent » distinguées ; suppression des pulsations ordinaires. | Navigation et notifications réelles avec données fictives. |
| **14. Icônes** | Lucide pour les commandes et instructions reprises, avec libellés visibles. Les symboles de classement deviennent des rangs lisibles. | Relecture visuelle des parcours client, chauffeur, bureau et aide. |
| **15. Rédaction** | Pluriels réels, casse de phrase, dates françaises, virgule décimale et unités cohérentes. Les statuts stockés ne sont pas renommés dans les données. | Relecture des états singulier/pluriel et des montants, volumes et durées. |
| **16. Devis au clavier** | Cartes de devis transformées en boutons natifs nommés ; focus au détail, retour à la liste protégé et restauration du focus. L’envoi attend la confirmation réelle et conserve prix/note en cas d’échec. | Entrée, Espace, retour, double clic, échec puis reprise avec le même contenu. |
| **17. Sens des tendances** | Kilomètres et litres neutres sans objectif explicite. Les ratios de coût et de consommation utilisent un sens métier explicite. Zéro annonce « Stable » ; la période comparée est visible. Aucun calcul financier n’a été changé. | Tests `uiTrend` et vrai Dashboard : +100 % de km et +50 % de litres restent neutres ; −25 % de carburant/km est favorable. |
| **18. Application du socle** | Adoption explicite des contrats sur les écrans repris, inventaire versionné, exceptions justifiées et contrôle `audit:ui` en CI. Les commandes de navigation/cartes conservent une géométrie adaptée à leur contenu. | [Périmètre](./UI18_SCOPE.json), [conventions](./UI_COMPONENTS.md), [sondes rejouables](../scripts/ui18/README.md) et résultats navigateur. |

## Mesures de place, sans promesse de vitesse utilisateur

Même fixture et mêmes données fictives, référence 4.26.0 chargée depuis Git. Les positions excluent le bandeau de démonstration et les marges extérieures selon la méthode de chaque sonde.

| Écran / largeur | Avant 4.26.0 | Après 4.27.0 |
|---|---:|---:|
| Premier groupe client, 320 px | 1 087 px | 454 px |
| Premier groupe client, 390 px | 1 018,5 px | 454 px |
| Première tournée, 320 px | 435 px | 192 px |
| Première tournée, 390 px | 387 px | 192 px |
| Première tournée, 1 365 px | 338 px | 253 px |

Dans la liste client mesurée, les sept anciennes commandes de 30 à 42 px passent à au moins 44 px ; les adresses passent de 12 px tronquées à 14 px avec retour à la ligne. Avec les données volontairement longues, le premier groupe client est à 474 px sur téléphone. Ces mesures portent sur la disposition de l’écran, pas sur un temps réel de travail gagné.

Les relevés initiaux du terrain utilisaient déjà un socle partiellement modifié : ils ne sont pas présentés comme un avant/après strict de 4.26.0. Les positions finales du scanner et les limites des mesures figurent dans le [rapport terrain](./UI18_TERRAIN_DECISIONS.md).

## Vérifications

- TypeScript, compilation frontend et fonctions ; **245 tests unitaires** et **127 vérifications Firebase** (31 règles, 32 intégration, 41 serveur, 13 cycle de tournée, 10 Storage).
- Le build conserve l’avertissement préexistant sur le chunk Firebase d’environ 651 kB minifié ; il ne bloque pas la compilation.
- Audits des dépendances frontend et fonctions : **0 vulnérabilité signalée** au moment de la validation.
- Contrats partagés : **36 contrôles navigateur**, plus **10 contrôles de navigation** Retour/Avancer, menu, brouillon et envoi en cours. Contrastes mesurés du texte des boutons : principal 7,56:1, secondaire 10,35:1, danger 6,47:1.
- Parcours client : création, copie exacte, dépliage, recherche, rechargement et reprise, import, carnet, consultation/intervention et succès partiels.
- Parcours bureau : densité, tableaux/cartes, devis au clavier, erreurs d’enregistrement et double soumission ; préparation du dispatch avec adresses complètes.
- Parcours terrain : scan, manifeste, garde-fous, erreur/réponse perdue, arrêt manuel et preuves en attente ; 31 handlers métier comparés structurellement à la version précédente.

Les preuves retenues sont versionnées sous [docs/validation/ui18](./validation/ui18/). Les essais intermédiaires de sondes remplacés par des relances corrigées sont identifiés dans les rapports des lots. Les scénarios utilisent des services simulés ou des émulateurs : aucun envoi client, livraison, message de support ou écriture métier de production n’a servi de test.

Ces validations couvrent les 18 corrections logicielles demandées et les parcours décrits. Elles ne constituent pas une certification de toute l’application. Le clavier système iOS/Android, la caméra, le GPS extérieur, une imprimante et un lecteur d’écran physiques n’ont pas été testés : un viewport court vérifie la place disponible, pas le fonctionnement de ces appareils.
