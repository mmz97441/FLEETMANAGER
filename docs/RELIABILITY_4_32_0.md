# Fiabilité terrain — 4.32.0

Cette version répond aux incidents de chargement de pages, de reprise après veille,
de journalisation et d’identification Boiron observés en septembre 2026.

## Boiron

Un code de commande ne suffit pas à identifier un carton parmi plusieurs colis.
La nouvelle colonne facultative **Code Boiron** conserve le code physique en texte,
avec ses 22 chiffres et ses zéros initiaux. L’import vérifie la commande intégrée au
code, refuse les cellules numériques susceptibles d’être arrondies et les doublons.

Pour les colis déjà importés : **Opérations Hub → Associer une étiquette Boiron**.
Le bureau ou le secrétariat relève le numéro BR et le code Boiron sur le même carton,
vérifie le destinataire et confirme la correspondance. Le serveur interdit les
associations contradictoires, y compris concurrentes, et conserve un événement
d’audit. L’association seule ne charge, ne transfère et ne livre aucun colis.

Le code associé est ensuite reconnu par la recherche, la vérification physique et
le scan serveur commun aux prises en charge, livraisons, enlèvements, chargements
hub et transferts. Les règles empêchent une écriture directe du code ou du registre.

**Les correspondances historiques ne sont pas devinées.** Si aucun code individuel
n’était fourni à l’import, une vérification physique reste nécessaire. Le bureau
peut alors enregistrer la correspondance une fois pour toutes.

## Pages et mises à jour

Les chemins `/assets/` absents ne sont plus réécrits vers le HTML de l’application.
Le cache demande une revalidation au lieu de conserver une mauvaise réponse un an.
Les pages chargées à la demande disposent d’un délai, d’une reprise locale et d’un
rechargement explicite. La navigation reste affichée après un échec de module.
Le rechargement respecte les opérations en cours et avertit sur les saisies.

La présence publie également la dernière version et le dernier build signalés par
le compte. Le bureau peut repérer les versions à mettre à jour ; ce champ ne prouve
pas que tous les appareils d’un même salarié utilisent cette version.

## Veille et stockage mobile

L’annuaire et la présence abandonnent les réponses devenues obsolètes lors d’une
mise en veille. Ils peuvent reprendre au retour sans attendre indéfiniment une
ancienne requête. Le profil possède également un délai global pour son secours serveur.

La connexion IndexedDB des preuves est rouverte après fermeture par le navigateur.
Une ouverture bloquée est bornée et une ouverture tardive abandonnée est refermée.
En cas d’assertion interne Firestore ou de panne de curseur, un message unique
propose de relancer l’application sans déconnexion. Aucun cache, aucune base ni
preuve locale n’est supprimé. Le SDK et son cache persistant sont conservés.

Cette récupération traite le blocage observable ; elle ne constitue pas une preuve
d’élimination de tous les défauts internes WebKit/Firestore. Une validation sur les
téléphones physiques reste nécessaire, notamment veille, appel et retour au scanner.

## Journal et comptes existants

Les erreurs sont conservées localement avant leur envoi. Un tampon mémoire permet
aussi l’envoi pendant la session si localStorage est indisponible. La limite reste
de 50 entrées. Un endpoint indépendant du cache Firestore du navigateur reçoit les
lots ; les références stables évitent les doublons après une confirmation perdue.
Un compte ne peut pas envoyer les erreurs attribuées à un autre compte.

L’activation d’un compte existant conduit vers la connexion et la récupération du
mot de passe. Un délai réseau n’est plus présenté comme une invitation expirée.
Le bureau reçoit également une explication lors du renvoi d’une invitation à un
compte déjà activé. Aucun email de test n’est envoyé par les validations.

## Validation et déploiement

- Tests unitaires : délais, réponses tardives, journal hors ligne, stockage indisponible,
  réouverture de la base de preuves avec conservation des photos/signatures.
- Tests serveur sur émulateurs : unicité concurrente Boiron, absence de mutation métier
  lors de l’association, parcours de scan, import idempotent et journal idempotent.
- Tests de règles et suites existantes : droits, livraison, missions, votes et stockage.
- Fixture navigateur `scripts/reliability/fixture.mjs`, sonde `probe.mjs` : données
  fictives, connexions Firebase de production bloquées, reprise de page, association,
  comptes existants et contrôle réel du parsing Excel.

Publier les fonctions `associateCarrierBarcode`, `recordClientErrors`, `scanPackage`,
`importPackages`, `recordUserPresence`, `getTeamDirectory` et les règles Firestore
avant le frontend. Les clients déjà installés restent compatibles avec ces fonctions.
Les fonctions anciennes et les autorisations d’authentification sont conservées.

Références techniques utilisées : [configuration Vercel](https://vercel.com/docs/project-configuration/vercel-json)
et [persistance Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline).
