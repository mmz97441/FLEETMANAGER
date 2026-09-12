# UI 4.27 — décisions et vérifications terrain

Lot du 12 septembre 2026, fondé sur `audit-ui-v4.26.0-2026-09-12/AVIS-UI-COMPLET.md`. Propriétés : DriverMissionView, QuickScanButton, HelpCenter, ClientHelp, SupportRequest, DeviceDiagnostics, PendingSyncBanner et BarcodeScanner. Aucun service, journal, modèle de données, règle de livraison ou appel serveur n’a été modifié dans ce lot.

## Décisions par axe

| Axe | Décision appliquée | Vérification |
| --- | --- | --- |
| VIS-03 | Boutons principaux de marque, secondaires blancs, danger pour la confirmation d’échec ou la suppression de preuve. Au début de la livraison, Scanner est prioritaire et Continuer secondaire ; Continuer conserve le garde-fou d’exception. Les choix de lieu et d’urgence affichent leur sélection et `aria-pressed`. | Cibles visibles ≥44×44 dans les parcours inspectés ; états désactivés, création occupée et reprise testés. |
| VIS-04 | En-tête PageHeader commun dans les deux aides ; dégradé violet et gros médaillons supprimés. Guides, questions, contact et appareil restent atteignables. | Captures aide interne et client à320/390/1365px ; boutons Appareil/Assistance vérifiés. |
| VIS-05 | Adresse, destinataire et étape courante prioritaires ; références de colis, statuts, aides, erreurs et numéros d’étapes ≥14px. Les références longues restent intégrales et reviennent à la ligne. | Noms/adresses/codes longs en résultat QuickScan ; aucun débordement horizontal ; audit statique sans écart sur ce lot. |
| VIS-06 | En-tête chauffeur compact : arrêt/statut/appel, contact, adresse, métadonnées en ligne et notes visibles. Suppression de la seconde liste identique de colis pendant le scan ; la checklist reste complète. Références consultables aux étapes suivantes. Manifeste en liste divisée, compteurs simples, moins de cartes d’aide imbriquées. | Bouton Scanner à335,5/269,5/244,75px depuis le début de la carte pour320/390/1365px. Appel, instructions et garde-fous préservés. |
| VIS-10 | Plein écran mobile explicite et footer partagé pour création hors import, arrêt manuel, échec et retour ; suppression du second défilement dans le retour. Les longs manifestes et envois utilisent également le mode mobile plein écran. | À390×420px simulés, les4 footers sont entièrement visibles après animation ; le champ téléphone QuickScan focalisé reste au-dessus du footer. Escape, champs associés aux labels, fermeture pendant envoi et confirmation de saisie conservés. |
| VIS-12 | Résultat QuickScan : destinataire/adresse puis code/statut/suivi, une confirmation de prise en charge ; les erreurs restent visibles. Succès et attente serveur demeurent distincts dans les envois. Assistance centrée sur brouillon puis ouverture volontaire du logiciel email. | Échec du premier scan suivi de reprise confirmée une fois ; création réussie sans nouvelle invitation à créer le même colis ; preuve en attente jamais présentée comme reçue. |
| VIS-14 | Icônes Lucide pour commandes, statuts et instructions chauffeur/scanner. Les notifications existantes gardent leurs marqueurs internes de gravité, mais sont rendues avec une icône Lucide ; les traces métier restent intactes. | Scanner manuel, avertissement, manifestes, saisie de preuve et étapes capturés ;31 handlers métier comparés structurellement à4.26. |
| VIS-15 | Pluriels réels pour prises en charge, retours, articles, livrés et échecs ; instructions GPS au vouvoiement ; titres sobres. Les valeurs techniques et la terminologie «Non effectué» existante restent intactes. | Relecture des libellés visibles et audit statique. |
| VIS-18 | Adoption du contrat ui-button, ui-panel, ui-notice, PageHeader et Modal mobileFullscreen. L’interface caméra conserve ses commandes blanches sur fond sombre et ses contrôles44px ; les couleurs de sévérité restent sémantiques. | Inventaire ci-dessous, tests de contraste, relecture indépendante du socle et des protections. |

## Inventaire des variantes retenues

- `ui-button-primary` : scanner actif, poursuivre l’étape lorsque les prérequis sont réunis, valider, créer, transmettre au bureau ou ouvrir le logiciel email après aperçu.
- `ui-button-secondary` : retour, fermeture, sélection neutre, test matériel volontaire, scanner secondaire après complétude.
- `ui-button-danger` : confirmer l’échec de livraison et supprimer une photo. Le choix d’une urgence n’est pas une action destructive ; sa sélection conserve une couleur de sévérité explicite.
- `ui-button-ghost` : onglets secondaires de contenu, en-têtes repliables, masquer et fermer lorsque le contexte le justifie. Texte blanc explicite pour masquer une notification sombre.
- `ui-notice-info/success/warning/danger` : information, réception/confirmation réelle, attente/incomplet et échec. Aucun compteur ordinaire ne devient une urgence par sa seule valeur positive.
- Dialogue mobile plein écran : longs formulaires seulement, footer stable, corps défilant unique. Scanner : vue immersive sombre existante.
- Aide client : demande de support visible ; diagnostic et mesures locales repliables, car facultatifs pour l’action de contact. Les notes de livraison et avertissements nécessaires à l’action courante restent visibles.

## Preuves finales

Résultats finaux et captures représentatives versionnés dans [validation/ui18/terrain](./validation/ui18/terrain/). L’ensemble des artefacts locaux reste dans `/Users/niceguillaume/Desktop/Fleetgenius/validation-ui18-terrain`.

| Fichier | Résultat |
| --- | --- |
| `visual-results.json` |51 contrôles réussis : aide, résultats longs,44px, absence de débordement, accès diagnostic, scan obligatoire et formulaires390×420. Aucune exception JavaScript. |
| `browser-results.json` |17 contrôles réussis : manifeste en erreur puis reprise, protection de saisie, assistance et déclenchement volontaire des permissions. |
| `manual-stop-recovery-results.json` |8 contrôles réussis du vrai caller : commit simulé/réponse perdue, champs figés, réouverture après changement de tournée, même mission/payload/requestId, deux appels pour un seul arrêt, stockage indisponible sans nouvel appel. |
| `extra-results.json` |4 contrôles réussis : erreur de recherche distincte de colis inconnu, blocage fermeture/re-scan/Escape pendant création, succès unique. |
| `delivery-metrics-results.json` |3 contrôles réussis : aucune observation avant soumission ; erreur et succès enregistrés après réponse réelle du service fictif, sans identifiant. |
| `driver-contrast-results.json` |4 assertions réussies et2 mesures : avertissement chauffeur `rgb(120,53,15)` sur blanc, contraste9,07:1 aux deux largeurs mobiles. |
| `invariant-results.json` |31 handlers d’opérations structurellement identiques à`1facefb` : opérateurs, arguments, gardes et chaînes conservés. La comparaison ignore mise en forme, style de guillemets et parenthèses redondantes. |
| `after.json` |Géométrie chauffeur finale, largeur de document égale au viewport aux trois tailles, Scanner44px. |
| `source-sha256.json` |Empreintes des8 composants gelés. |
| `typecheck.txt`, `unit-tests.txt` |TypeScript réussi ;13 tests unitaires dans pendingManualStop, driverManualStopRequest et supportContext. |

Les captures `reference-v4.26-driver-*.png` viennent des preuves historiques4.26. Les fichiers `baseline.json` et `baseline-driver-*.png` sont des mesures prises en début de cette séance avec un socle déjà partiellement modifié : ils ne constituent pas une comparaison numérique stricte avec4.26. Aucun gain de vitesse utilisateur n’est inféré de ces mesures de position.

À390×420px, les footers arrêt manuel/échec/retour mesurent61px ; le footer QuickScan, avec action principale et commandes secondaires, mesure113px. Leur bord inférieur est à420px après la fin de l’animation. Un premier relevé avant stabilisation de l’animation a été écarté et remplacé par la mesure stabilisée.

Les fixtures rendent les composants réels et remplacent uniquement leurs services externes par des données fictives. Les confirmations, signatures/photo injectées, réponses perdues et états de permissions sont simulés. Aucune livraison, notification métier, demande de support, impression ou écriture de production n’a été réalisée.

## Limites explicites

Ces contrôles utilisent Chrome sur ordinateur et une taille de viewport réduite pour simuler le clavier. Ils ne constituent pas une séance sur téléphone physique ni un test du clavier système iOS/Android, du GPS extérieur, de la lecture caméra, de l’imprimante ou d’un lecteur d’écran. La grille de diagnostic reste volontaire et initialisée à«Non testé». Aucune réussite physique n’est déclarée.
