# Rejouer les contrats UI et la navigation

Ces sondes utilisent les composants React réels et remplacent les services par des données fictives. Elles ne se connectent pas à un compte métier. Les domaines Firebase et les fonctions distantes sont également bloqués par les sondes Chrome.

Avec Node 22, les dépendances installées et Chrome disponible :

1. Depuis la racine du dépôt : `node scripts/ui18/fixture.mjs` (port local 5244, cache Vite isolé).
2. Lancer une instance Chrome isolée avec `--headless=new --remote-debugging-port=0 --user-data-dir=/tmp/fleet-ui18-root-browser --no-first-run about:blank`. Sur macOS, utiliser le binaire situé dans l’application Google Chrome. Si le répertoire diffère du dossier temporaire de Node, définir `FLEET_UI18_CHROME_PROFILE` à ce chemin pour les sondes.
3. Exécuter `node scripts/ui18/contracts-probe.mjs`, puis `node scripts/ui18/navigation-probe.mjs`.
4. Examiner les JSON et captures produits dans `docs/validation/ui18/root/`, puis fermer le serveur et cette instance Chrome.

La galerie se trouve sur `http://127.0.0.1:5244/__gallery`. Elle vérifie les actions aux trois largeurs, les tailles calculées, les tendances du vrai tableau de bord, les notifications, les fenêtres imbriquées et les brouillons. La seconde sonde teste Retour/Avancer et les changements de vue avec saisie ou envoi en cours. Les vues métier de cette dernière sont fictives ; le cadre App, la navigation et les dialogues sont réels.

Le contrôle rapide sans navigateur est `npm run audit:ui`. Il complète ces essais, sans prétendre vérifier un clavier système, une caméra, un lecteur d’écran ou une imprimante physique.
