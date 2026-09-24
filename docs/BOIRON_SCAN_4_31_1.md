# Reconnaissance des étiquettes Boiron — 4.31.1

## Incident observé

Les journaux des 22 et 23 septembre contiennent des refus `not_found`. Deux
codes numériques de 22 chiffres commencent par `00` puis contiennent une
référence de commande importée. Ces deux commandes correspondent respectivement
à cinq et deux cartons. Les colis importés portent des identifiants individuels
`BR…`, sans correspondance enregistrée avec le code numérique complet.

Au premier contrôle du 24 septembre, 22 scans étaient confirmés et aucun refus
n'était enregistré ce jour-là. Ce constat ne prouve pas que les caméras des
chauffeurs décodent les étiquettes : une saisie manuelle produit le même reçu,
et une caméra qui ne décode rien n'appelle pas le serveur.

## Comportement corrigé

- Une étiquette numérique dont la référence de commande existe déclenche une
  explication et demande le code individuel du carton. Elle ne propose plus
  de créer un colis hors import et ne déplace aucun carton.
- Cette déduction reste un indice de recherche, jamais une validation physique,
  même si un seul carton est enregistré pour la commande. Un code numérique
  complet enregistré comme véritable code-barres reste prioritaire.
- Les recherches utilisées au hub et pour les transferts refusent aussi une
  référence partagée, sans choisir le colis le plus récent ou encore actif.
- Le navigateur et le serveur partagent l'extraction des identifiants, y compris
  les préfixes de symbologie AIM et les codes GFL enrichis. Un code court ne
  valide plus un identifiant plus long ayant le même début.
- L'aide reste visible avec la liste des colis ; la réponse du serveur apparaît
  aussi en saisie manuelle. Les commandes nécessitant un numéro individuel
  gardent un avertissement dans l'écran de prise en charge.

## Validation

Données synthétiques exclusivement pour les opérations de scan de test :
327 tests unitaires, dont les recherches ambiguës et la distinction entre
référence de commande et numéro de carton ; 28 scénarios métier du scanner
dans la suite Firebase émulée ; 30 contrôles navigateur sur des largeurs de
320, 390 et 1365 pixels. Les reprises de tournée, doublons, rejouages réseau,
preuves de livraison et droits restent couverts par la suite existante.

## Limite et prochaine vérification terrain

Cette version ne prétend pas décoder automatiquement le carton individuel à
partir du code numérique Boiron. Il faut une correspondance fiable dans les
données importées ou le numéro individuel `BR…`. Aucun rang de carton n'est
inventé à partir de l'ordre des lignes d'import. Une photo lisible de l'étiquette
qui échoue et le message exact du téléphone restent nécessaires pour confirmer
que l'incident signalé le 24 septembre correspond aux échecs retrouvés.

Aucune donnée opérationnelle existante n'est migrée par ce correctif.
