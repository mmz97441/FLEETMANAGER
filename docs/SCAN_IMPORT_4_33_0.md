# Scans et imports — 4.33.0

Les refus d’identification de cartons, les imports incomplets et les contrôles de livraison sont désormais distingués. Aucun rapprochement entre une étiquette physique Boiron et un BR n’est déduit d’une simple référence de commande.

## Comportement

- Le contrôle de livraison ou d’enlèvement exige la tournée du jour et le bon arrêt. Il ne crée pas de tournée, ne transfère pas le colis et ne modifie pas son statut. Un contrôle accepté, y compris répété, est présenté comme une confirmation. Les reprises réseau restent idempotentes et sont isolées par arrêt.
- Le refus d’un colis livré indique la remise enregistrée lorsqu’elle est disponible. Un code inconnu oriente vers le BR et la vérification de l’import. Le code lu et l’arrêt demandé figurent dans l’audit serveur.
- Les imports gardent un état serveur par liste de références : attendues, confirmées, non confirmées et lignes rejetées. Le résultat des écritures est vérifié et les colis sont relus avant le bilan. Les données persistées et les anciennes étiquettes sont conservées lors d’une reprise. Un colis livré ou déjà affecté n’est pas proposé à nouveau au dispatch.
- Les deux parcours d’import prennent en charge la correspondance Boiron. Les codes numériques arrondis par Excel sont rejetés ; le parcours bureau permet de corriger la référence et le code individuel avant import.
- Opérations Hub présente les imports récents incomplets et les cartons Boiron sans association, avec accès au formulaire prérempli. Les historiques antérieurs à cette version ne disposent pas de liste des références attendues.
- Le journal de la direction réunit erreurs techniques et refus parmi les dernières activités. Il indique une reprise acceptée ultérieure lorsqu’une correspondance certaine existe dans les événements chargés. Les droits existants du journal restent inchangés.
- La création exceptionnelle passe par un appel serveur, exige une vérification déclarée avec le bureau et vérifie à nouveau l’absence du code. Elle est auditée et marquée à réconcilier. Les règles empêchent une création terrain directe ou la falsification d’un contrôle de scan.
- Une pause caméra transitoire ne provoque plus immédiatement un redémarrage. Les rejets de reprise vidéo sont interceptés. Après deux reprises automatiques en une minute, la saisie manuelle devient disponible avec conservation des scans ; le chauffeur peut relancer explicitement la caméra.

## Validation

- TypeScript frontend et serveur, compilation frontend, audit UI et différences Git.
- 350 tests unitaires ; 32 tests d’intégration.
- Émulateurs : 46 contrôles des règles principales, 41 contrôles serveur généraux, 13 de cycle de mission, 28 de scan, 49 de vote, 8 de profil/session, 9 de fiabilité existants, 10 nouveaux de scan/import, 10 de stockage et 42 des règles de vote.
- Nouveaux cas : mauvais arrêt, tournée obsolète, contrôle répété, preuve existante, import interrompu et rejoué, lignes rejetées, création simultanée, import concurrent avec création exceptionnelle, droits d’accès aux confirmations.
- Navigateur isolé : 14 contrôles caméra et reprise ; 17 contrôles imports, association, journal et création exceptionnelle, en 320, 390 et 1365 pixels. Services distants bloqués et données fictives.

## Publication et vérification terrain

Publier les fonctions `scanPackage`, `importPackages`, `createAdHocPackage`, puis le frontend et les règles Firestore validées. La nouvelle création terrain exige le frontend 4.33.0 ; actualiser après sauvegarde des opérations en cours, sans effacer le stockage des preuves.

Les correspondances historiques manquantes nécessitent les deux étiquettes du même carton. Le fichier d’origine est nécessaire pour reconstituer les références absentes. Aucun colis de production n’a été créé, déplacé ou livré par les tests. La reprise sur le téléphone physique ayant signalé les interruptions reste à confirmer.
