# Carnet, équipe, interventions et demandes client

La recette Chrome des composants réels `ClientRequestsPanel`, `ClientRequestsManager` et `ViewAsSwitcher` passe **20 assertions**, sans exception, à 320, 390 et 1280 pixels. Les résultats sont dans [actions-browser.json](actions-browser.json).

Elle vérifie l’erreur réseau sans faux succès, la conservation de la demande après fermeture, la reprise de la même identité, l’isolation des utilisateurs, l’accusé et l’historique, la consultation sans modification, une clôture concurrente conservant la réponse non envoyée, la version après un accusé propre et l’annulation d’une intention en attente lors de la fin d’intervention. Le fixture active React StrictMode.

Les services sont simulés à leurs frontières ; les endpoints Firebase externes sont bloqués. Ces tests ne contactent aucun utilisateur et ne modifient aucune donnée de production. Les autorisations et transactions sont vérifiées séparément par `scripts/test-client-actions.cjs` : **49 contrôles serveur/règles sur émulateur**. Les tests unitaires ciblés du lot passent également.

Depuis la racine du dépôt, lancer la fixture puis un Chrome isolé dans des terminaux séparés :

```sh
node scripts/client-actions-fixture.mjs
```

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --remote-debugging-port=0 --user-data-dir=/private/tmp/fleet-client-actions-browser about:blank
```

Puis `node scripts/client-actions-probe.mjs`. La fixture écoute `127.0.0.1:5261`. Arrêter la fixture et le Chrome dédié à la fin de la recette.
