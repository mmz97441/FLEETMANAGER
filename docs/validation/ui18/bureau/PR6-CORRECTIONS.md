# Correctifs ciblés après revue PR6

Deux défauts corrigés dans le lot bureau, sans changement de service ou de flux métier :

1. VehicleCard et VehicleRow utilisent maintenant `isPastLocalDate(technicalControlDate)`. Une échéance d’aujourd’hui reste valable jusqu’à la fin du jour local ; seul un jour antérieur est signalé dépassé.
2. La zone « Itinéraire & Contacts » de QuoteManager utilise `md:col-span-2`, sans répétition du préfixe responsive.

Le helper partagé ajouté à `src/utils/date.ts` est `daysUntilCalendarDate(value, reference = new Date()): number | null`. Il accepte une chaîne, Date ou timestamp, et renvoie null pour une entrée absente/invalide. Il extrait les jours locaux via localDatePart, valide les jours calendaires, puis calcule la différence entre leurs minuits UTC. Le changement d’heure ne peut ainsi transformer hier en aujourd’hui. `isPastLocalDate` appelle ce helper et compare le résultat à zéro. Le parent réutilise également ce contrat dans Dashboard.

## Preuves

- `date.test.ts` : **21 tests passants dans chacun des trois fuseaux** Indian/Reunion, America/Los_Angeles et UTC. Cas hier/aujourd’hui/demain au début et à la fin du jour, passage annuel, jours de changement d’heure, valeur absente et dates impossibles. Les 21 tests comprennent les 7 tests préexistants et 14 nouveaux cas.
- `npx tsc --noEmit` et `git diff --check` passants.
- `pr6-browser.json` : **14 assertions passantes, zéro exception**. Les vrais composants VehicleCard (320 px) et VehicleRow (1365 px) sont évalués à 00:01:59 et 23:59:59 à La Réunion. Hier est dépassé ; aujourd’hui et demain ne le sont pas.
- À 1365 px, le trajet devis occupe **838,67 px sur les 838,67 px de sa grille**, avec `grid-column: span 2 / span 2`. Les adresses longues de départ et d’arrivée sont présentes intégralement, sans paragraphe tronqué ni débordement horizontal. Capture relue : `pr6-quote-route-1365.png`.

Sondes manuelles conservées dans le dossier de travail `validation-ui18-bureau` : `pr6-fixture-server.mjs` puis `pr6-probe.mjs`. Fixture locale, écritures Firebase neutralisées, heure figée pour les échéances ; aucune donnée ou opération réelle utilisée.
