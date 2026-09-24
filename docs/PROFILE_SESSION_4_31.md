# Profils et état de connexion — 4.31.0

Une erreur Firestore au chargement du profil était transformée en profil absent, puis en déconnexion avec un message d’accès refusé. La carte assimilait aussi l’absence de position GPS à « Jamais connecté », y compris pendant le chargement ou après une erreur de lecture.

Le démarrage distingue maintenant panne de lecture, profil absent, compte désactivé et session révoquée. Une lecture serveur du seul profil authentifié prend le relais si le canal navigateur échoue ou reste bloqué cinq secondes. Les erreurs temporaires proposent de réessayer sans effacer la session ni les données locales. Une génération par tentative empêche les réponses anciennes de modifier une nouvelle session. La révocation utilise `auth_time`, comme les règles et les fonctions serveur. La récupération par email conserve son contrôle de propriété et ne crée aucun rôle par défaut.

L’activité est indépendante du GPS. L’application visible transmet un signal chaque minute, horodaté côté serveur. Le statut expire après trois minutes sans signal (actualisation d’affichage toutes les trente secondes). Sans signal enregistré, le statut est inconnu. La dernière connexion correspond à la dernière ouverture enregistrée, conservant la convention des anciennes versions. Les dates existantes restent affichées. Une absence de date signifie « Non renseignée », jamais une preuve d’absence historique de connexion. Les applications anciennes ne publient pas ce nouveau signal avant leur mise à jour.

La carte distingue positions en mémoire, chargement serveur, positions confirmées et erreur. Les pages Utilisateurs et Carte présentent l’état d’activité et la date/heure de dernière connexion. L’annuaire interne conserve ces champs opérationnels sans exposer les données RH.

Validation locale : typecheck, 313 tests unitaires, 254 contrôles sur émulateurs (règles, intégration, serveur et stockage), builds application/fonctions, audit UI sans écart. Neuf contrôles navigateur spécifiques et dix contrôles de navigation/brouillons réussissent avec des données fictives, sans exception JavaScript. Simulation mobile Chrome ; aucune exécution sur les iPhone physiques des chauffeurs.

Déploiement : publier les fonctions `getOwnProfile`, `recordUserPresence`, `linkAuthToProfile`, `getTeamDirectory` et les règles Firestore avant le frontend. Les fonctions modifiées restent compatibles avec les anciennes versions. Aucun compte historique orphelin n’est réactivé et aucun droit n’est élargi.
