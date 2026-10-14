# Validation du suivi, des preuves et des statistiques client

Corrections de C06, C07, C12, C14–17 et C21, plus conservation des preuves propres à chaque colis dans le bon de livraison. Recette locale du 14 octobre 2026, version de travail 4.38.0. Aucune donnée métier de production modifiée par ce lot.

## Comportements vérifiés

- La fiche ouverte et une tentative en attente de preuve conservent une écoute après sortie des colis actifs. Une photo publiée après la livraison apparaît sans fermer la fiche, y compris hors première page d’historique.
- Les sources locales sont identifiées comme telles. Le chargement complet relit les colis actifs et toutes les pages historiques auprès du serveur, attend les vérifications de retrait et ne certifie pas un résultat incomplet. Les consultations simultanées partagent le chargement en cours.
- Les retraits, suppressions et changements de périmètre sont réconciliés. Une fiche ouverte réaffectée à un autre client disparaît du flux. Les réponses d’un ancien abonnement sont ignorées après fermeture.
- Les réserves, références réelles, adresse de la tentative et heure de La Réunion sont identiques dans la preuve à l’écran et son document. Le lien GPS est conservé. Le document attend le chargement des images avant de déclencher l’impression ; les références avec caractères spéciaux et les URL signées sont échappées une seule fois.
- Le bon de livraison reprend le groupe client complet : destinataire strict, étage et jour de création à La Réunion. Les demandes à des dates ou créneaux différents restent visibles séparément. Une preuve d’un colis ne certifie aucun autre colis du groupe.
- L’absence de GPS récent ne change pas le statut de livraison. La liste conserve les colis en livraison et la carte ne place que les positions fraîches.
- Les événements historiques utilisent leur destinataire et leur zone figés ; le travail restant utilise la destination actuelle. Un échec chez A reste chez A après une livraison chez B. Une zone historique non enregistrée est présentée comme inconnue, sans être déduite de la zone actuelle.
- Sans tentative décidée, le taux reste non mesurable et aucune tendance de taux n’est inventée. Les anciens encours et les absences à l’enlèvement restent signalés. Les alertes suivent les filtres sélectionnés.
- Excel et PDF sont accessibles depuis les statistiques. Chaque export revérifie tout l’historique. Les tentatives de la période et la situation actuelle sont distinctes ; une réussite ultérieure ne remplace pas un échec passé. Un changement de compte pendant le chargement abandonne le document en attente. Les fenêtres bloquées et les échecs réseau sont expliqués.
- Le dernier retour expéditeur est identifié sans renommer les anciens retours au dépôt. Les nouvelles décisions utilisent leur résultat explicite ; les anciens mouvements demandent une décision concordante et le même horodatage.

## Résultats

- 48 tests ciblés : flux de colis, souscriptions client, métriques, historique, exports XLSX, contenu des preuves, retours et suivi GPS.
- Vérification TypeScript : aucune erreur.
- Audit UI : 62 fichiers, 406 commandes, 7 tableaux, 47 fenêtres ; aucune violation statique.
- Build Functions réussi, puis 10 vérifications serveur de preuves sur l’émulateur Firestore existant, sans effacement global. Le scénario de publication vérifie aussi que deux colis conservent chacun leur zone de tentative malgré une correction ultérieure.
- Recette Chrome sur les composants réels à 320, 390 et 1280 pixels, navigateur réglé sur Paris : 20 assertions réussies, aucune exception JavaScript. [Résultats navigateur](evidence-browser.json), [preuve avec réserves](proof-reserves-390.png), [filtre historique A](analytics-historical-filter-390.png).

## Reproduction

Depuis la racine du dépôt :

```sh
npx vitest run src/services/parcelFeed.test.ts src/services/clientPackageSubscription.test.ts src/services/logisticsMetrics.test.ts src/components/logisticsAnalytics.test.tsx src/services/clientAnalyticsHistory.test.ts src/utils/proofPresentation.test.tsx src/components/clientTracking.test.tsx src/services/aiAnalytics.test.ts
npx tsc --noEmit
npm run audit:ui
npm --prefix functions run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-delivery-evidence.cjs
```

La dernière commande nécessite l’émulateur déjà initialisé pour le projet de démonstration. Elle utilise des identifiants propres à son exécution.

Pour la recette navigateur, démarrer dans deux terminaux distincts :

```sh
node scripts/client-evidence-fixture.mjs
```

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --remote-debugging-port=0 --user-data-dir=/private/tmp/fleet-client-evidence-browser about:blank
```

Puis exécuter :

```sh
node scripts/client-evidence-probe.mjs
```

Le fixture utilise le port 5260 et les composants réels ClientAnalytics, ClientLiveTracking et PODViewer. Les colis, réponses de rafraîchissement et fenêtres d’impression sont synthétiques ; AskData est neutralisé et les domaines Firebase sont bloqués. Cette recette valide le contenu HTML destiné à l’impression, pas une sortie physique d’imprimante ni la disponibilité des médias de production. Les tests du flux simulent les événements Firestore ; les tests serveur de preuves utilisent l’émulateur réel. Aucun résultat ne mesure la latence ou le volume réel d’un compte client.

Les archives sans destinataire ou zone figés restent explicitement incomplètes. Le lot ne reconstitue pas ces données par supposition et ne remplace pas une preuve manquante par une preuve d’un autre colis.
