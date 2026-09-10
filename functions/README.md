# Fonctions serveur FleetGenius

Node.js 22, Firebase CLI 15.15.0 et Java 21 pour les émulateurs. Installer les dépendances avec `npm ci --prefix functions`, puis compiler avec `npm run build --prefix functions`, depuis la racine.

Les fonctions gèrent les invitations et activations, les comptes, les absences et soldes, les affectations, transferts, retours, imports, acceptations de devis, notifications, l’annuaire et les appels Google. Les fichiers `lib/` sont régénérés automatiquement avant un déploiement grâce au hook `predeploy`.

La configuration serveur est décrite dans [.env.example](.env.example). Le conseiller IA reste indisponible tant que sa clé et son modèle ne sont pas configurés. La clé Gemini ne doit jamais être injectée dans le frontend. Le projet Google Route Optimization peut être différent du projet Firebase : vérifier son API, sa facturation et les droits du compte de service.

La recette reproductible, les changements de schéma et les conditions de publication figurent dans [PRODUCTION-READINESS.md](../PRODUCTION-READINESS.md). Les tests utilisent exclusivement un projet de démonstration local. Ils n’envoient aucun email réel et ne contactent pas les API Google métier.
