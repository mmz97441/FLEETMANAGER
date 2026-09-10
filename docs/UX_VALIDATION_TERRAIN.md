# Vérifier l’application sur les téléphones de l’équipe

« Faire la recette sur téléphone » signifie essayer les actions quotidiennes avec de vrais appareils, puis noter ce qui fonctionne et ce qui bloque. Il ne s’agit pas de relire le code : une personne utilise l’application pendant qu’une autre observe, sans lui dicter chaque clic.

Les simulations dans Chrome vérifient notamment l’affichage, les messages et les fenêtres. Elles ne valident pas la caméra du téléphone, la lecture des étiquettes, les autorisations du système, la précision du GPS, le clavier iOS/Android ou une coupure réelle de réseau. Ce document est un protocole à exécuter : **aucun résultat terrain n’y est prérempli**.

## Participants et préparation

| Participant | Appareil | Rôle dans l’essai |
|---|---|---|
| Chauffeur 1 | Téléphone Android, Chrome | Livraison, coupure réseau, reprise et retour au hub |
| Chauffeur 2 | iPhone, Safari | Mêmes parcours, pour vérifier les différences entre appareils |
| Exploitant | Poste de préparation habituel | Préparer les données, vérifier les résultats et observer les demandes d’aide |
| Client | Appareil qu’il utilise habituellement | Créer une expédition et vérifier son suivi |

Prévoir environ une heure, sans déplacement routier. Effectuer les manipulations à l’arrêt. Utiliser des comptes, destinataires et colis de test identifiables dans l’environnement retenu ; ne pas expérimenter sur des livraisons clients en cours. L’exploitant note les identifiants exacts utilisés pour rapprocher les résultats.

Préparer pour chaque chauffeur : une tournée affectée, un arrêt avec deux colis scannables, un autre arrêt pour l’essai hors ligne, et un colis réellement marqué « À retourner ». Prévoir une étiquette abîmée ou un code inconnu pour vérifier l’erreur, un destinataire de test consentant pour la signature et un accès au hub. Pour l’import, préparer un fichier de trois lignes : une valide, une avec une adresse manquante et une référence répétée. Noter le résultat attendu pour chaque ligne avant l’essai.

| Informations de session | À remplir |
|---|---|
| Date, heure et observateur | ____________________ |
| Environnement, URL et version affichée | ____________________ |
| Android : modèle / version système / version Chrome | ____________________ |
| iPhone : modèle / version iOS / version Safari | ____________________ |
| Autre appareil client / navigateur | ____________________ |
| Réseaux disponibles : Wi-Fi / réseau mobile | ____________________ |
| Comptes et identifiants de test | ____________________ |
| Lot d’import et nombre final attendu | ____________________ |

## Cinq parcours essentiels

### 1. Se connecter et retrouver son activité

Chacun se connecte avec son propre compte, sans indications de l’observateur. Les chauffeurs ouvrent leur tournée ; le client retrouve ses colis ; l’exploitant ouvre la préparation des tournées. Sur téléphone, faire apparaître le clavier, afficher puis masquer le mot de passe. Tester également une saisie incorrecte et une tentative sans réseau, puis revenir à une connexion normale.

**Réussite :** le formulaire est trouvable immédiatement, le clavier ne rend pas l’action inaccessible, les erreurs distinguent identifiants et réseau, et chacun atteint une vue correspondant à son rôle. L’application ne présente pas de réussite quand la connexion échoue. Aucune information n’est coupée horizontalement.

**Mesure :** chronométrer depuis l’affichage de la connexion jusqu’à l’ouverture de la bonne activité. Noter les retours, clics inutiles et demandes d’aide, sans compter le temps consacré à retrouver un mot de passe oublié.

### 2. Livrer avec scan, photo et signature

Chaque chauffeur démarre sa tournée de test selon le parcours normal, ouvre l’arrêt de deux colis et enregistre son arrivée. Scanner d’abord le code inconnu : lire le message et retrouver cet essai dans l’historique. Scanner les vrais colis, renseigner le réceptionnaire et l’état de la marchandise, prendre une photo, signer et revoir le récapitulatif.

Avant validation, revenir d’une étape pour corriger le nom du réceptionnaire. Vérifier que la photo et la signature restent présentes. Valider une seule fois, puis faire contrôler le résultat par l’exploitant. Refaire un essai distinct de remise partielle : un colis remis et un colis déclaré réellement absent, en lisant la confirmation avant de continuer.

**Réussite :** chaque étape et chaque bouton sont lisibles sans zoom ; aucune action n’est recouverte ; la caméra s’ouvre ; les codes attendus sont reconnus ou la saisie manuelle fonctionne ; le refus d’un code inconnu reste consultable. La correction ne détruit pas les preuves déjà saisies. Le serveur contient un résultat par colis, la bonne photo, la bonne signature et le bon réceptionnaire. Dans l’essai partiel, seul le colis remis est livré ; l’autre est en échec.

**Mesure :** durée entre l’ouverture de l’arrêt et la confirmation, nombre de scans nécessaires par code, erreurs de toucher, retours en arrière et demandes d’aide. Exclure le déplacement physique.

### 3. Enregistrer hors ligne puis reprendre l’envoi

Ouvrir le second arrêt en étant connecté, avec la localisation autorisée. Préparer la preuve, couper le Wi-Fi et les données mobiles, puis valider. Consulter « Envois des livraisons » : identifier l’arrêt, l’heure de sauvegarde et ce qui attend l’envoi. Mettre l’application brièvement en arrière-plan puis y revenir. Ne pas vider le stockage du navigateur ni changer de compte.

Rétablir une connexion stable. Observer la reprise et, si nécessaire, utiliser « Réessayer ». L’exploitant vérifie le résultat reçu. Ouvrir le bilan de fin de tournée avant puis après synchronisation.

**Réussite :** l’écran indique que les données sont conservées sur le téléphone ; il n’annonce pas que le serveur a reçu ce qui n’a pas été envoyé. La preuve reste identifiable après retour dans l’application. Après reprise, elle est reçue une seule fois, sans refaire la livraison ni créer de doublon. Une preuve en attente empêche la clôture et le bilan donne accès à l’envoi concerné.

**Mesure :** durée jusqu’à la sauvegarde locale, puis durée entre le rétablissement du réseau et la réception confirmée. Noter le type de réseau, le nombre de photos et les éventuels nouveaux essais. Si l’envoi n’aboutit pas après deux minutes de connexion stable, noter un échec de cet essai et le message affiché, sans déclarer la preuve perdue avant investigation.

### 4. Confirmer un retour au hub

Chaque chauffeur retrouve le colis de test « À retourner » depuis le bilan de sa tournée. Au hub, ouvrir le retour, prendre une photo puis ouvrir la signature de réception. Revenir de la signature au retour pour vérifier que les fenêtres et leurs boutons restent accessibles. Confirmer la remise réelle et faire contrôler le statut par l’exploitant.

**Réussite :** le chauffeur trouve quel colis retourner, où agir et quelle preuve fournir. Le retour ne peut pas être confirmé sans photo. La fenêtre de signature n’active pas les commandes situées derrière elle. Après confirmation serveur, le colis est « Retourné » et n’apparaît plus comme retour demandé. Aucune autre livraison ne change de statut.

**Mesure :** durée pour trouver le retour puis le confirmer, erreurs de toucher, fermetures involontaires et demandes d’aide. Si la localisation est refusée ou indisponible, noter le message exact et l’accès à l’assistance ; ne pas modifier les contrôles métier pour faire réussir l’essai.

### 5. Importer puis créer une expédition côté client

L’exploitant importe le fichier de test et vérifie les correspondances de colonnes. Repérer la ligne incorrecte et la référence répétée, lire les explications, corriger ce qui doit l’être puis confirmer le lot. Comparer le nombre annoncé avec les références effectivement créées.

Le client crée ensuite une expédition distincte avec deux colis. Avant d’enregistrer, saisir une adresse puis tenter de fermer le formulaire : choisir « Continuer la saisie » et vérifier les champs. Terminer la création, consulter le résultat et ouvrir les étiquettes. L’exploitant vérifie les deux colis, leur destinataire et leur disponibilité pour la suite du traitement.

**Réussite :** les erreurs d’import sont localisées et compréhensibles ; aucune ligne rejetée n’est annoncée comme créée ; la gestion de la référence répétée correspond au résultat attendu préparé avant l’essai. Le nombre et les identifiants créés sont exacts. Le client conserve sa saisie après annulation de la fermeture, comprend la réussite et retrouve les deux colis et les étiquettes correspondantes. Une nouvelle tentative ne produit pas de création supplémentaire inattendue.

**Mesure :** durée de compréhension des erreurs d’import, durée de correction, durée de création de l’expédition, nombre de lignes rejetées, erreurs et demandes d’aide.

## Grille de résultats à remplir

Une ligne par personne et parcours. « Non testé » reste un état distinct de « Réussi ». Les codes de statut sont : **R** réussi, **E** échec, **NT** non testé. Une réussite avec aide doit conserver le nombre de demandes d’aide.

| Participant / appareil | Parcours | Durée | Erreurs ou blocages | Aide demandée : nombre et motif | Statut R/E/NT | Identifiants et observation |
|---|---|---|---|---|---|---|
| Chauffeur 1 / Android | 1. Connexion | À remplir | À remplir | À remplir | À remplir | À remplir |
| Chauffeur 2 / iPhone | 1. Connexion | À remplir | À remplir | À remplir | À remplir | À remplir |
| Exploitant / poste | 1. Connexion | À remplir | À remplir | À remplir | À remplir | À remplir |
| Client / appareil habituel | 1. Connexion | À remplir | À remplir | À remplir | À remplir | À remplir |
| Chauffeur 1 / Android | 2. Livraison standard et partielle | À remplir | À remplir | À remplir | À remplir | À remplir |
| Chauffeur 2 / iPhone | 2. Livraison standard et partielle | À remplir | À remplir | À remplir | À remplir | À remplir |
| Chauffeur 1 / Android | 3. Hors ligne et reprise | À remplir | À remplir | À remplir | À remplir | À remplir |
| Chauffeur 2 / iPhone | 3. Hors ligne et reprise | À remplir | À remplir | À remplir | À remplir | À remplir |
| Chauffeur 1 / Android | 4. Retour au hub | À remplir | À remplir | À remplir | À remplir | À remplir |
| Chauffeur 2 / iPhone | 4. Retour au hub | À remplir | À remplir | À remplir | À remplir | À remplir |
| Exploitant / poste | 5. Import | À remplir | À remplir | À remplir | À remplir | À remplir |
| Client / appareil habituel | 5. Expédition | À remplir | À remplir | À remplir | À remplir | À remplir |

## Décision et suivi

Pour accepter les parcours testés, exiger : aucune perte de saisie ou de preuve, aucun doublon, aucun statut métier incorrect, aucune action obligatoire inaccessible, et une erreur compréhensible avec une possibilité de reprise. Les parcours chauffeur doivent réussir sur les deux systèmes. Une manipulation réalisée seulement par l’observateur ne vaut pas réussite autonome.

Les durées et demandes d’aide constituent la première mesure d’usage ; elles ne prouvent pas un gain de temps sans mesure antérieure comparable. Classer chaque échec, consigner les étapes permettant de le reproduire, puis rejouer le seul parcours concerné après correction.

| Décision de l’exploitant | À remplir |
|---|---|
| Parcours acceptés | ____________________ |
| Parcours bloqués ou non testés | ____________________ |
| Correctifs nécessaires et responsable | ____________________ |
| Date de nouvel essai | ____________________ |
| Observateur / exploitant | ____________________ |
