# Décisions UI du lot client — 4.27.0

Périmètre : ClientPortal, CreateShipmentModal, ViewAsSwitcher, ShipmentReference, RecipientsManager, AccountHub et les deux imports client. Les services, règles, identités de colis, journaux et mécanismes de confirmation ne sont pas modifiés. ClientAccessContext reste inchangé.

| Axe | Décision appliquée | Preuve principale |
| --- | --- | --- |
| VIS-01 | Le destinataire, l’adresse entière et le statut précèdent les références. Une référence longue est explicitement annoncée « Référence abrégée », révélable et sélectionnable. Copie et partage utilisent la chaîne originale, sans espace ajouté, alias ni modification d’identité. | Scénarios `keyboard-reference-search-*`, captures `after-reference-*`. |
| VIS-02 | Suppression de la grande carte profil répétée et des cinq grandes cartes de statut. Une ligne d’identité, un titre, la création, une recherche, un filtre et une section secondaire repliée précèdent les résultats. Les impressions de groupe sont accessibles dans le détail. | `measurements-before.json` / `measurements-after.json`. |
| VIS-03 | Le primaire commun désigne l’étape suivante : créer, importer, enregistrer ou imprimer après création. Les consultations, copies et actions secondaires utilisent les variantes communes. Les destructions confirmées conservent leur variante danger. | `controls-inventory.json`, captures formulaires et résultats. |
| VIS-04 | PageHeader pour les expéditions, le tableau de bord, les devis, l’entreprise et les destinataires. Retrait du bandeau dégradé et de l’affichage inconditionnel « Compte Premium ». | Captures portail et carnet. |
| VIS-05 | Informations utiles à14 px minimum dans le lot, destinataire16 px, champs de saisie16 px. Adresses, noms et contacts reviennent à la ligne. | Mesures de styles calculés, captures normales et longues. |
| VIS-06 | La liste de colis et le carnet utilisent des séparations lisibles. Réduction des cartes imbriquées du compte et du formulaire de création ; fin du défilement imbriqué mobile dans les listes d’import. | Captures carnet, création et imports. |
| VIS-07 | Le total devient une information séparée. Le statut est un filtre explicitement nommé : select compact mobile, commandes `ui-filter` avec état accessible sur écran large. | Mesures, scénarios chargement/erreur/réessai. |
| VIS-09 | Les objets de devis et trajets peuvent revenir à la ligne ; leur référence et le demandeur ne forcent plus une ligne étroite. | Relecture du composant ClientPortal ; les tableaux bureau relèvent du lot bureau. |
| VIS-10 | Fullscreen mobile opt-in pour les formulaires client. Confirmation fixe hors défilement pour création, devis, import et carnet ; fenêtres centrées conservées sur ordinateur. | Création320×568, imports et carnet aux 3 largeurs ; viewport réduit320×360. |
| VIS-11 | Mode court dans le titre ; noms acteur/client complets dans le sous-titre fixe, y compris dans un enfant. Emails et explications sont accessibles dans « Identités ». Activation explicite et audit avant écriture conservés. | `nested-preview-context-*`, `preview-readonly-and-audited-intervention-*`. |
| VIS-12 | Résultat d’expédition hiérarchisé : enregistrement, destinataire, éventuels problèmes secondaires, format et références. Imprimer est l’action suivante. Carnet et impression ne relancent jamais la création. Pour un devis, bilan hors formulaire conservé sans minuterie : chaque adresse distingue ajout confirmé, déjà présente et non confirmé ; un succès ne masque pas l’autre échec. | `result-print-independent-*`, `quote-created-address-*`. |
| VIS-14 | Commandes et états UI du lot utilisent Lucide, y compris la navigation de l’aperçu et les dates. | Inventaire de source sans emoji UI. |
| VIS-15 | Accords singulier/pluriel des créations, offres, imports et destinataires ; formulations en casse normale ; unité m³ ; le pied de liste compte des colis affichés. | Scénarios d’import d’une ligne et création d’un colis. |
| VIS-16 | Le détail de destinataire et le suivi se déclenchent par boutons nommés avec état déplié ; retrait du clic sur un conteneur non interactif. | Activation par Entrée, Tab/Shift+Tab ; le défaut QuoteManager est traité par le lot bureau. |
| VIS-18 | Tous les boutons natifs du lot passent par `ui-button`/`ui-filter`. PageHeader, Modal, FormInput et notices sont réutilisés ; dates et dimensions du devis sont reliées à leurs libellés. | `controls-inventory.json` : aucun bouton sans contrat. |

VIS-08 (tables bureau), VIS-13 (navigation globale) et VIS-17 (kilométrage) sont portés par les autres lots, et ne sont pas déclarés vérifiés ici.

Les avertissements secondaires restent persistants dans leur écran ; seule une fermeture explicite du bilan de devis l’acquitte. Ce bilan est un état du portail, pas un nouveau journal serveur durable.
