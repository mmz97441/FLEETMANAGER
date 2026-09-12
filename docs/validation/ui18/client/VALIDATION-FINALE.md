# Validation finale du lot client — 12 septembre 2026

Le manifeste à intégrer est **browser-final-results.json : 36 scénarios distincts réussis, aucune exception JavaScript non interceptée**. Chaque résultat contient sa source brute. Les captures associées, scripts et CSV fictifs sont dans ce répertoire.

## Mesures finales comparables

Le serveur de référence charge les fichiers src et CSS exacts du commit 1facefb368c2d73a0ee951f4cdd71115579c95cd via `git show`, sans autre checkout. Les bandes et boutons d’ouverture de fixture sont masqués et exclus de la mesure. Une attente de450 ms stabilise les animations. Les dernières mesures incluent le PageHeader mobile commun.

| Largeur | Premier groupe avant | Après | Réduction |
| --- | ---: | ---: | ---: |
| 320 px | 1087px | 454px | 58,2% |
| 390 px | 1018,5px | 454px | 55,4% |
| 1365 px | 513,5px | 384px | 25,2% |

Avec des noms/adresses longs, les résultats après sont474/474/384px. Le destinataire passe de14 à16 px et l’adresse de12 à14 px. Les adresses longues sont lisibles, sans troncature. Les 7 boutons de moins de44 px de l’ancienne liste disparaissent ; aucun bouton visible mesuré dans la nouvelle liste n’est inférieur à44 px. Ces nombres décrivent cette fixture ; ce ne sont pas des temps de tâche mesurés auprès d’utilisateurs.

## Suites finales et reproduction

Avec une instance Chrome de test isolée utilisant `/private/tmp/fleet-ui18-client-browser` et un port CDP dynamique :

- `node fixture-server.mjs` : vrais composants et services neutralisés, port5217.
- `node fixture-server.mjs --baseline` : composants4.26.0 exacts, port5218.
- `node measure.mjs --baseline` puis `node measure.mjs` : mesures et captures.
- `node probe.mjs` : création/reprise, erreurs/réessai, consultation/audit, invitation, clavier/référence et rechargement.
- `node probe-additional.mjs` : identités imbriquées, compte en consultation, carnet et impression indépendante.
- `node probe-imports.mjs` : deux imports, lignes valides/rejetées, footer fixe, confirmations et accords.
- `node probe-quote-result.mjs` : devis confirmé avec carnet partiel ou doublon ; Tab/Shift+Tab et viewport réduit.
- `node inventory.cjs` : inventaire des boutons et contrat commun.

Les commandes Node supposent les dépendances du dépôt production-fixes présentes au chemin de travail indiqué dans les scripts. Les CSV et tous les acteurs/colis des fixtures sont fictifs. Les scripts ne lancent ni Firebase ni écriture de production.

## Provenance des retests et historique

Les fichiers bruts suivants gardent les premières tentatives de sonde ; ils ne doivent pas être utilisés seuls comme statut final :

- `browser-results.json` : 12 scénarios métier réussis. Les premières assertions clavier utilisaient un événement Entrée sans caractère natif ; les premières mesures de footer lisaient l’animation avant stabilisation. Résultats remplacés par `browser-keyboard-reload-results.json` et `browser-mobile-reload-results.json`.
- `browser-keyboard-reload-results.json` : clavier réussi aux 3 largeurs et rechargement1365 réussi. Les rechargements mobiles lisaient encore l’ancien document entre `Page.reload` et la nouvelle page ; retests mobiles réussis dans `browser-mobile-reload-results.json` après attente d’un marqueur du nouveau document.
- `browser-additional-results.json` : carnet et impression réussis aux 3 largeurs. Le sélecteur exact « Mon compte » ignorait le sous-titre de la carte ; retest imbriqué réussi dans `browser-nested-results.json` après sélection de la carte complète.

Le manifeste final sélectionne le dernier résultat par identifiant stable et conserve `supersededProbeErrors` avec l’historique explicite. Les scripts complets ont reçu les corrections de sonde ; aucun défaut applicatif n’a été masqué en supprimant une assertion.

## Vérifications complémentaires et limites

Les 25 tests existants `clientMutation`, `shipmentReference`, `pendingClientShipment` et `clientShipmentForm` passent. Le dernier `npx tsc --noEmit` exécuté au gel du lot passe sur le dépôt partagé. Les échecs transitoires de compilation des autres lots pendant leur édition ont été remontés à l’orchestrateur et résolus. La CI et le contrôle global de livraison appartiennent à l’intégration.

Chrome headless a rendu les composants réels aux largeurs320,390,1365 et au viewport réduit320×360. Aucune validation physique de téléphone ni clavier système n’est prétendue. Le dernier test vérifie un viewport réduit, pas le comportement d’un clavier iOS/Android réel. Les requêtes métier externes sont bloquées ; la police Google Fonts est également bloquée, donc les captures utilisent une police de repli identique avant/après. Les scénarios ne remplacent pas la recette production des permissions serveur, des imprimantes ou du réseau mobile réel.
