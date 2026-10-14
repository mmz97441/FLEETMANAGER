# Validation terrain du flux logistique — 4.36.0

Ce protocole complète les tests automatisés et les essais navigateur. Il reste à exécuter sur les téléphones réellement utilisés, avec leurs caméras, leurs étiquettes et leur connexion. Les tests automatisés ne prouvent pas la lisibilité physique de chaque étiquette.

## Préparation

- Vérifier la version 4.36.0 dans l’application et, au bureau, la version signalée par chaque appareil.
- Préparer trois arrêts : un colis ; trois colis ; au moins dix colis. Ajouter un colis destiné à une autre pharmacie.
- Prévoir plusieurs expéditeurs, des références BR et des références génériques, dont une avec zéro initial.
- Chaque carton doit avoir une référence individuelle. Un numéro de commande commun à plusieurs cartons ne suffit pas à identifier l’un d’eux.

## Création et import

- Importer les références sous forme de texte ; vérifier que les zéros initiaux sont conservés.
- Vérifier destinataire, adresse, étage, date demandée, créneau et durée de service.
- Deux destinataires différents, deux étages différents ou des créneaux incompatibles ne doivent pas être fusionnés.
- Un doublon de référence individuelle doit être expliqué et refusé ; plusieurs cartons d’une commande restent possibles.

## Prise en charge

- Scanner chaque carton : seul le bon carton passe au vert ; un code inconnu ou ambigu affiche une explication.
- Fermer puis rouvrir la page : retrouver les scans et la signature déjà enregistrés.
- Faire un enlèvement partiel : les cartons absents ne doivent pas être déclarés collectés. Le bureau doit pouvoir organiser une nouvelle collecte.
- Couper le réseau pendant la validation : retrouver l’opération en attente, puis vérifier qu’elle se synchronise une seule fois.

## Hub et dispatch

- Réceptionner physiquement les colis au bon hub avant de les affecter.
- Un colis d’un autre hub exige une réception physique explicite et tracée.
- Vérifier que la date demandée reste visible ; une autre date ou une modification des créneaux exige un motif conservé.
- Corriger une adresse avant départ : vérifier le colis et l’arrêt. Une correction individuelle ne doit pas déplacer les autres destinataires.

## Livraison

- Avant l’arrivée, retrouver les références et le nombre de colis à remettre à cet arrêt.
- Scanner un, trois puis dix colis : le compteur augmente une fois par carton, sans recommencer le formulaire pour chacun.
- Scanner le colis d’une autre pharmacie : croix rouge et explication ; aucun ajout au compteur.
- Scanner un bon colis : confirmation verte. Le rescanner ne double pas le compteur.
- Vérifier qu’un numéro de commande partagé est refusé comme ambigu, sans sélection automatique d’un carton.
- Compléter une seule preuve pour les colis réellement remis à l’arrêt. Les colis absents ou refusés doivent rester distingués.
- Vérifier le GPS requis pour une remise, la photo et les informations demandées, puis la signature selon le parcours affiché.
- Couper le réseau, recharger, puis rétablir la connexion : conserver la preuve et éviter les doubles validations.

## Échecs, retours et reprise

- Déclarer un échec avec son motif : retrouver cet échec et sa preuve côté bureau et client concerné.
- Rapporter physiquement le colis au hub, avec la preuve et le hub de retour.
- Il reste en attente de décision jusqu’à une décision explicite : relivraison ou retour à l’expéditeur.
- Une nouvelle tentative doit avoir sa propre preuve. La photo ou la signature d’un autre compte ou d’une ancienne tentative ne doit pas être préremplie.
- La file de reprise doit montrer aussi les dossiers des jours précédents et les preuves en attente.

## Consultation et analyse

- Vérifier les mêmes résultats dans les indicateurs, les détails et les exports pour une même période.
- Une synchronisation tardive conserve la date de l’événement terrain ; elle ne devient pas une livraison du jour de réception serveur.
- Attendre le chargement complet de l’historique avant une analyse ou un export intégral.
- Une preuve absente reste signalée. Ne jamais confirmer une livraison uniquement pour faire disparaître une alerte.

Pour tout écart : noter appareil, version, écran, référence du colis, heure et message exact. Transmettre les informations opérationnelles par le canal de support habituel.
