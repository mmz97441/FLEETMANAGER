# Livraison UX/UI 4.25.0 — 10 septembre 2026

Cette version applique les recommandations du rapport aux parcours chauffeur, bureau et client, ainsi qu’aux composants communs. La revue a été répartie entre trois agents puis intégrée et vérifiée par l’orchestrateur. Les contrôles automatisés ne constituent pas une certification d’accessibilité de tous les écrans ni une séance avec utilisateurs réels.

## Corrections supplémentaires révélées par les essais

- Une création client non confirmée conserve désormais sa demande sur cet appareil avant l’appel serveur, y compris après fermeture et rechargement. Le contenu et l’identifiant restent identiques à la reprise. Un stockage indisponible bloque l’appel. L’abandon du rappel demande une vérification explicite des colis déjà enregistrés.
- Les imports conservent les accents, les téléphones commençant par zéro, les résultats par ligne et la correspondance réelle des IDs aux zones. Les étiquettes d’un import rejoué sont produites depuis les données relues en base.
- Une exception du calcul de tournée reste visible. Un changement manuel de date n’est plus annulé par un ancien lien. Les liens directs vers les onglets d’action respectent les permissions.
- Les barcodes client conservent l’identité complète de la demande tout en utilisant l’alphabet numérique compact de CODE128. La largeur A6 respecte les marges. La géométrie et le décodage ont été vérifiés, y compris après rasterisation à 203 et 300 dpi.
- Les dialogues respectent les touches consommées par un champ enfant ; leur autofocus ignore les commandes désactivées. Les anciennes erreurs de confirmation sont effacées à la réouverture.

## Couverture des 40 recommandations

« Implémenté » désigne les modifications dans les parcours et composants cités, pas une garantie d’absence de défaut dans tout le produit. Les points 39 et 40 séparent volontairement la validation simulée du travail sur appareils et avec utilisateurs.

| Point | État | Réalisation / limite |
| --- | --- | --- |
| UX-01 — Mettre la connexion au premier écran mobile | Implémenté | Connexion compacte ; bouton visible à 320 × 568, 390 × 844 et sur ordinateur. |
| UX-02 — Associer les libellés aux champs | Implémenté | FormInput/Select/Textarea : identifiants uniques, labels et messages associés ; formulaires client, connexion et champs bureau repris. |
| UX-03 — Maintenir le focus dans les fenêtres | Implémenté | Pile de fenêtres partagée : fond inerte, Tab, Échap contextuel et retour du focus ; confirmations et signatures imbriquées vérifiées. |
| UX-04 — Rendre le bouton Envoyer réellement opérationnel | Implémenté | Action explicite « Ouvrir ma messagerie », sujet/corps encodés et consigne de finalisation. Aucun faux ticket envoyé. |
| UX-05 — Protéger les saisies contre la fermeture accidentelle | Implémenté | Protection des saisies et des opérations en cours dans les formulaires principaux ; journal des créations client non confirmées. |
| UX-06 — Adapter la barre mobile au métier | Implémenté | Raccourcis chauffeur : accueil, tournée, scan, aide ; raccourcis bureau filtrés par permissions. |
| UX-07 — Renforcer les contrastes des textes et actions | Implémenté | Palette de marque, texte secondaire selon le fond, actions de confirmation et focus renforcés. |
| UX-08 — Agrandir les informations utiles au chauffeur | Implémenté | Informations terrain agrandies, formulaires mobiles à 16 px et retour à la ligne des textes utiles. |
| UX-09 — Nommer et agrandir les boutons à icône | Implémenté | Commandes principales et terrain nommées, cibles élargies ; état du mot de passe annoncé. |
| UX-10 — Éviter que les bannières recouvrent les actions | Implémenté | Réseau, mise à jour et synchronisation placés dans le contenu ; accès aux commandes préservé. |
| UX-11 — Rendre visibles les raisons qui empêchent la clôture | Implémenté | Bilan de clôture : arrêts restants, retours et preuves en attente, avec accès aux éléments concernés. |
| UX-12 — Permettre de comprendre et traiter les preuves en attente | Implémenté | Détail des preuves conservées : tournée, arrêt, heure, erreur, état reçu et relance ; images non conservées dans les états de présentation. |
| UX-13 — Distinguer erreur réseau et identifiants incorrects | Implémenté | Messages distincts pour réseau, identifiants, compte désactivé et limitation des tentatives. |
| UX-14 — Faciliter le remplissage par le téléphone | Implémenté | Types email/tel, inputMode, autocomplete et labels persistants sur les formulaires repris. |
| UX-15 — Conserver onglets, filtres et contexte dans les liens | Implémenté | Onglets, dates, recherches, statuts et identifiants dans les URL ; retour entre vues avec contexte et défilement. |
| UX-16 — Clarifier les entrées de l’exploitation | Implémenté | Entrées exploitation renommées et recherche de colis dans le cadre de l’application. |
| UX-17 — Unifier vocabulaire et ton | Implémenté | Tournée, arrêt, préparation, réception et suivi employés dans les parcours repris ; faux contacts retirés de l’ancienne aide client. |
| UX-18 — Donner la priorité au prochain arrêt | Implémenté | Prochain arrêt et action immédiate avant le détail et le bilan de la tournée. |
| UX-19 — Réduire les manipulations sans enlever les preuves | Implémenté | Guide de livraison maintenu ; commandes secondaires repliées sans suppression des contrôles de preuve. |
| UX-20 — Expliquer les blocages GPS et documents au bon moment | Implémenté | Explications GPS/documents et accès à l’aide ; contrôles métier conservés. |
| UX-21 — Conserver les erreurs de scan assez longtemps | Implémenté | Erreur de scan persistante, historique récent et saisie manuelle accessibles. |
| UX-22 — Afficher la disponibilité réelle des données | Implémenté | Hub : chargement, erreur, aucun hub et absence d’opérations distingués ; notifications en erreur explicites. |
| UX-23 — Structurer la préparation d’une tournée | Implémenté | Préparation en trois étapes, retour sans perte et résumé avant affectation. |
| UX-24 — Rendre les exclusions de planification actionnables | Implémenté | Exclusions visibles avec accès à la correction de l’adresse/créneau ; absence de cause exacte signalée. |
| UX-25 — Rendre explicite la portée des actions groupées | Implémenté | Sélection totale, hors filtre et sur d’autres pages annoncée ; confirmation des actions groupées. |
| UX-26 — Distinguer devis et création directe d’expédition | Implémenté | Demande de devis et création directe d’expédition présentées comme deux actions différentes. |
| UX-27 — Dissocier création, carnet et impression | Implémenté | Création confirmée, carnet et impression indépendants ; fenêtre bloquée et réimpression prises en charge. |
| UX-28 — Expliquer pourquoi un formulaire ne peut pas être validé | Implémenté | Erreurs par champ et résumé ciblable ; informations figées lors d’une reprise ambiguë. |
| UX-29 — Améliorer le traitement des imports en erreur | Implémenté | Bilans par ligne, exports réimportables, reprise par référence, UTF-8/Windows-1252 et zéros initiaux conservés ; IDs associés à leur vraie zone. |
| UX-30 — Distinguer heure prévue, estimation et position réelle | Implémenté | Créneau demandé, estimation calculée et position GPS datée distingués dans le suivi. |
| UX-31 — Rendre navigation et tableaux utilisables au clavier | Implémenté | Focus visible, menu et fenêtres au clavier ; lignes activables et correction des cellules sans perte de focus. |
| UX-32 — Unifier les messages et leur durée | Implémenté | Toasts communs, erreurs persistantes et confirmations accessibles ; erreurs essentielles également dans les formulaires. |
| UX-33 — Actualiser l’aide et rendre le contact immédiat | Implémenté | Guides livraison partielle, synchronisation et retours actualisés ; contacts cliquables et version du build. |
| UX-34 — Consolider la bibliothèque de composants visuels | Implémenté | Socle partagé et conventions documentées dans UI_COMPONENTS.md ; contrats de fermeture, erreurs et permissions explicités. |
| UX-35 — Réduire la concurrence entre couleurs et décorations | Implémenté | Action principale mise en avant sur connexion, tournée, préparation et création ; détails et bilans secondaires regroupés. |
| UX-36 — Respecter la préférence de réduction des animations | Implémenté | Préférence prefers-reduced-motion respectée par les transitions et animations. |
| UX-37 — Adapter les fenêtres au clavier et aux écrans courts | Implémenté | Fenêtres à hauteur dynamique, contenu défilant, boutons mobiles et signatures vérifiés à 320/390 px. |
| UX-38 — Expliciter la période des indicateurs | Implémenté | Mois affiché explicitement ; suppression du basculement automatique vers un mois précédent. |
| UX-39 — Mesurer la fluidité sur téléphone et gros volumes | Mesure locale faite ; terrain à compléter | Mesure locale sur 1 000 colis, pages 50/100, accès aux 1 000 IDs vérifié. Mesures physiques et réseau réel restent à relever. |
| UX-40 — Mesurer les parcours réels et la compréhension | Protocole livré ; séances à réaliser | Protocole terrain prêt, fiches vierges et critères de décision. Les séances avec utilisateurs et téléphones réels restent à effectuer. |

## Validation

- Compilation TypeScript et build de production ; build des fonctions Firebase.
- **285 vérifications automatisées réussies** : 158 tests unitaires, 32 d’intégration, 31 contrôles Firestore, 54 scénarios serveur et 10 contrôles Storage. La CI du commit fusionné reste la référence de publication.
- Chrome avec données fictives : connexion, navigation réelle du cadre, fenêtres imbriquées, saisies, tournées, erreurs hub, scan manuel, imports, reprise et impression. Largeurs 320/390 et ordinateur ; aucun envoi de preuve, email de support, import ou mutation réelle de production pendant ces contrôles.
- 1 000 colis fictifs : accès intégral par pagination, sélection conservée et filtres contrôlés, y compris avec CPU ralenti ×4. La liste affichait déjà 50 lignes avant cette version : le gain vérifié est l’accès aux autres résultats, pas une accélération démontrée. Les lectures Firestore du bureau restent à optimiser selon la volumétrie réelle ; aucun plafond silencieux n’a été ajouté.
- Analyse des dépendances applicatives et serveur au seuil modéré : aucun avis détecté au moment du contrôle.

## Exploitation et limites pratiques

La page d’aide ouvre la messagerie du poste ; l’utilisateur doit y finaliser l’envoi. L’aperçu client conserve le comportement existant d’actions réelles sous le compte connecté et l’annonce clairement. Une demande d’expédition en attente est conservée localement par compte : ne pas effacer les données du navigateur avant sa résolution. Les nouvelles versions doivent préserver l’algorithme d’identité des demandes déjà journalisées.

La validation physique concerne la caméra, les permissions GPS, le clavier iOS/Android, la reprise après mise en veille et les imprimantes réellement utilisées. Elle exige des appareils et des opérateurs ; aucun résultat n’est inventé. Suivre [le protocole terrain](./UX_VALIDATION_TERRAIN.md). Les conventions de développement figurent dans [UI_COMPONENTS.md](./UI_COMPONENTS.md).

Cette livraison ne modifie ni les fonctions déployées ni les règles Firebase. Elle publie le frontend via la branche principale et le projet Vercel déjà relié à `delivrex.vercel.app`.
