# Mise à jour obligatoire des chauffeurs — 4.37.0

Un bandeau facultatif ne garantissait pas que les chauffeurs utilisent le dernier parcours de scan. Cette version détecte le déploiement publié et impose son installation, dès que l’opération en cours peut être terminée sans perdre sa saisie.

## Parcours

- Vérification du manifeste `/version.json` au démarrage, au retour sur l’application, à la reconnexion et toutes les 60 secondes lorsque la page est visible. Une seule vérification partagée, limitée à huit secondes.
- Chauffeur : écran « Mise à jour obligatoire », sans fermeture ni choix « plus tard ». Le bouton vérifie de nouveau la disponibilité réseau avant de recharger. Aucun rechargement automatique.
- Caméra, signature, formulaire, lecture de photo, sauvegarde locale ou envoi en cours : l’opération garde la main. Après sa fin, l’écran obligatoire apparaît. Une activité d’envoi qui commence alors que l’écran est ouvert désactive temporairement le bouton.
- Les preuves et opérations déjà conservées dans IndexedDB restent disponibles après rechargement. Leur présence seule ne bloque pas l’installation. Aucun effacement du stockage, des caches ou de la session.
- Hors connexion : une mise à jour déjà détectée reste obligatoire ; le chauffeur est invité à se reconnecter. Un échec réseau ou un manifeste invalide ne crée pas de nouvelle exigence inconnue.
- Un manifeste valide de retour arrière remplace l’exigence précédente. Si le déploiement correspond de nouveau au code ouvert, l’écran se retire. Une réponse réseau tardive ne peut pas remplacer une vérification plus récente.

## Contrôle au bureau

Dans la gestion des utilisateurs, la colonne de connexion et le filtre de version s’appuient sur le déploiement publié. Ils distinguent les appareils récemment signalés à jour, ceux nécessitant une mise à jour, les signaux vieux de plus de 24 h et les versions inconnues. Un signal de compte provenant d’un ancien client reste identifié comme tel : il ne certifie pas tous les appareils de ce compte. Les téléphones hors connexion ne peuvent pas fournir leur version actuelle avant leur prochaine connexion.

## Passage des clients déjà ouverts à ce mécanisme

Un ancien code JavaScript déjà ouvert ne peut pas recevoir le nouvel écran avant un premier rechargement. Les fonctions `scanPackage`, `prepareDeliveryStop` et `createAdHocPackage` exigent donc la version chauffeur 4.37.0 minimum. Une ancienne version, ou une requête sans version, reçoit une erreur explicite demandant de fermer le scanner puis d’installer la mise à jour ou de rouvrir l’application. L’authentification et l’état du compte restent contrôlés en premier.

Ce seuil sert à faire entrer les anciens clients dans le mécanisme obligatoire. Les versions suivantes continuent à suivre le dernier manifeste publié. Ce contrôle de compatibilité ne remplace pas les autorisations métier.

Les opérations de publication des preuves, de finalisation de livraison, de collecte et de retour ne dépendent pas de ce seuil : les éléments enregistrés avec un ancien client peuvent encore se synchroniser. Les nouveaux scans n’ont pas cette exception.

## Publication et retour arrière

1. Compiler et valider le site, les fonctions et les scénarios de mise à jour.
2. Publier le site 4.37.0 sur le projet Vercel `fleetmanager`, alias `delivrex.vercel.app`. Vérifier son manifeste et le chargement de la page.
3. Déployer ensuite les trois fonctions de scan avec le seuil minimum. Cet ordre évite de réclamer une version encore indisponible.
4. Pour revenir à une version antérieure à 4.37.0, abaisser ou retirer d’abord le seuil serveur de ces trois fonctions, puis publier le site. Pour revenir à un déploiement compatible, le manifeste fait autorité, y compris si son identifiant de build est plus ancien.

Les sondes utilisent des données fictives et des émulateurs locaux. Aucun scan ni changement d’état de colis réel n’est nécessaire pour cette recette. Une vérification sur les téléphones des chauffeurs reste utile pour confirmer leurs particularités de navigateur et de réseau.

## Validation

Le script `scripts/test-app-update.cjs` exerce les trois véritables fonctions sur émulateur : refus des anciennes versions sans mutation, versions minimum et futures, rôles chauffeur/chauffeuse, authentification prioritaire, comportement du bureau et publication/reprise d’une preuve sans version client.

Les tests de détection vérifient la persistance, le retour arrière, les erreurs de réseau et de manifeste, les requêtes partagées, le timeout et l’annulation. Les tests de sécurité vérifient le registre des opérations, les rechargements et les deux files locales.

La [recette navigateur de la mise à jour](validation/app-updates-4-37/gate-results.json) comporte 22 contrôles réussis à 320, 390 et 1 440 pixels : impossibilité de fermer l’écran, confinement du focus, hors connexion, nouvelle tentative, retour arrière, envoi en cours, formulaire restauré après ouverture de l’écran et conservation réelle des photos/signatures dans IndexedDB après rechargement. Aucune exception JavaScript, requête externe ou demande d’abandon de saisie n’a été observée.

La recette livraison ajoute 63 contrôles sur sept scénarios : dernier arrêt réussi ou échoué, photo lente et changement d’arrêt, preuve conservée après coupure réseau, échec d’envoi après enregistrement serveur puis reprise, stockage local refusé, arrêt terminé ailleurs pendant une saisie locale. Le formulaire est libéré uniquement après acquittement de sa preuve exacte par IndexedDB ; une écriture locale échouée conserve la saisie.

Validation locale globale : 445 tests unitaires, 39 intégrations, 70 contrôles Firestore, 10 Storage, 42 règles de vote, toutes les suites serveur et d’audit ; typage, deux compilations et 55 fichiers de contrats UI sans écart. [Résultats consolidés](validation/app-updates-4-37/validation.json).
