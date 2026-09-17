# Incidents mobiles — validation 4.28.1

## Corrections

- **Annuaire chauffeur** : un seul appel à la fois, délai maximal de 20 secondes, pause hors ligne ou lorsque la page est masquée. Reprises après 5, 15, 30 puis 60 secondes ; relance au retour du réseau ou de la page. Les collègues déjà chargés restent disponibles lors d’un échec transitoire. Un refus d’accès arrête les reprises et retire cette liste. Un changement de compte ou la fermeture de l’abonnement empêche une ancienne réponse de réinjecter ses données.
- **Erreurs JavaScript** : contexte de réseau et de visibilité, version de build, code Firebase, 20 actions récentes issues d’une liste fixe et jusqu’à 8 opérations en cours. Les actions de lecture/signature de document, ouverture/mode de scanner et confirmation de scan sont identifiables. Les noms d’actions ne contiennent ni valeur saisie, ni code colis, ni contenu de document/signature. Les paramètres et fragments d’URL de page/ressource ne sont pas ajoutés au contexte. Le contexte en mémoire change avec le compte.
- **Erreurs caméra et ressources** : la panne finale de démarrage caméra est journalisée avec son nombre d’essais et le motif d’autorisation lorsqu’il est disponible ; le passage à la saisie manuelle reste possible. Les ressources JS/CSS en échec sont distinguées des erreurs globales opaques.
- **Alertes répétées** : compteur dans une seule alerte ; après fermeture, une alerte technique identique n’est pas réaffichée pendant 60 secondes. Les erreurs métier restent visibles. Chaque occurrence continue à appeler le service de journalisation.
- **Envoi différé des erreurs** : un seul envoi du tampon par onglet ; les entrées ne sont retirées qu’après confirmation, sans écraser celles ajoutées pendant l’envoi. Reprise au retour du réseau ou de la page. Le tampon reste limité à 50 erreurs comme auparavant ; aucune file de preuve de livraison n’est modifiée.
- **Invitations** : ajout de l’index `used ASC, expiresAt ASC`, en conservant les index existants. L’index est prêt en production ; la requête qui échouait renvoie désormais HTTP 200. Aucune invitation n’a été supprimée pour cette vérification.

## Vérifications

TypeScript, compilation de production et audit UI sans écart. **280 tests unitaires réussis**, dont 16 nouveaux tests couvrant les reprises, le refus d’accès, les résultats arrivant après fermeture, les traces, les alertes et les courses lors de l’envoi du tampon.

**21 contrôles navigateur réussis**, dont des essais à 320, 390 et 1365 px. Les composants `ToastHost`, les services d’annuaire et de scan et le journal d’erreurs sont réels ; les appels Firebase sont remplacés par des réponses contrôlées. Une rafale de 23 erreurs est simulée pour vérifier le regroupement, la conservation du formulaire et la présence des traces. Ces essais ne reproduisent pas la cause initiale des erreurs sur le téléphone d’un utilisateur réel.

Les scripts et captures n’utilisent que des données fictives. Les logs de production et les identités restent hors du dépôt public.

## Rejouer

```sh
npm run typecheck
npm test
npm run audit:ui
npm run build
node scripts/mobile/fixture.mjs
```

Dans un autre terminal, démarrer Chrome avec un profil isolé et un port de débogage aléatoire : `--headless=new --remote-debugging-port=0 --user-data-dir=/tmp/fleet-mobile-browser --no-first-run about:blank`, puis lancer `node scripts/mobile/probe.mjs`. La sonde bloque les appels externes Firebase et écrit `browser.json` ainsi que les trois captures dans ce dossier.

## Limites

Une erreur `Script error.` dont le navigateur masque les détails reste marquée comme opaque. Les nouvelles traces facilitent l’identification de l’action et du contexte ; elles ne permettent pas d’inventer rétroactivement la cause d’un incident ancien. La cause physique des coupures réseau et le comportement d’une caméra réelle nécessitent une observation sur l’appareil concerné. La tâche nocturne d’invitations n’a pas été déclenchée manuellement ; sa requête a été contrôlée en lecture seule.
