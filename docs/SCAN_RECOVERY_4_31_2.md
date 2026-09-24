# Reprise du scan sans déconnexion — 4.31.2

Un incident signalé le 24 septembre a nécessité deux connexions et des
rafraîchissements avant la reprise des scans. Les journaux métier montrent
ensuite 25 confirmations, sans refus. Ils ne permettent pas de déterminer si
le blocage initial concernait la caméra, le chargement du lecteur ou la session.
Les traces nominatives sont conservées hors du dépôt.

## Corrections

- Le délai maximal du scan couvre aussi la préparation de l'authentification.
  Le SDK Firebase installé ne démarre son propre délai qu'après cette étape.
  Après 25 secondes sans réponse, l'écran redevient utilisable ; la demande
  conserve son identifiant pour que sa relance reste idempotente. Une réponse
  tardive ne remplace pas celle du nouvel essai.
- Une erreur met la rafale en pause et conserve les codes non confirmés dans
  la liste à réessayer. Les répétitions d'un même code déjà en attente ne
  rallongent plus indéfiniment la file.
- Chaque caméra possède son instance et son conteneur. Une ouverture ou une
  fermeture tardive ne peut plus arrêter ou effacer la caméra suivante.
- La caméra est libérée lorsque la page passe en arrière-plan et reprise au
  retour. Une piste vidéo interrompue peut être relancée automatiquement.
  Le bouton « Relancer la caméra » permet également une reprise sur place.
- Démarrage, arrivée de l'image et fermeture sont bornés. La saisie manuelle
  reste disponible si le navigateur ne rend pas la caméra. Un flux reçu après
  fermeture est encore nettoyé, même après expiration de l'attente.
- Un chargement de module échoué n'est plus conservé comme remplacement
  définitif du lecteur pendant toute la session. Un chargement trop lent
  propose la saisie manuelle et une relance. Son arrivée tardive n'efface pas
  une saisie manuelle commencée entre-temps.
- Les interruptions et démarrages trop longs sont journalisés. Les nouvelles
  étapes de diagnostic ne contiennent ni images caméra ni codes de colis.

## Vérification

332 tests unitaires réussis, contrôle TypeScript, audit UI et build production.
14 contrôles navigateur avec pannes simulées couvrent les interruptions,
reprises, réponses tardives, chargement lent et rafales. Six autres contrôles
utilisent le véritable lecteur html5-qrcode avec une vidéo artificielle Chrome
pour vérifier démarrage, libération, retour de page et changement de mode.

Commandes : `node scripts/scan/camera-fixture.mjs` puis
`node scripts/scan/camera-probe.mjs`. Le second mode de la fixture utilise
`SCAN_REAL_CAMERA=1` et `scripts/scan/real-camera-probe.mjs`, avec un navigateur
isolé lancé avec les options de média simulé de Chrome. Les résultats sont
écrits sous `/private/tmp`, sans données ni accès Firebase de production.

Ces vérifications reproduisent les défauts du code ; elles ne constituent pas
un essai de la caméra physique du chauffeur et ne prouvent pas rétrospectivement
le déclencheur exact de son incident.
