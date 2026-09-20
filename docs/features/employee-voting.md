# Votes des salariés — 4.29.0

Le menu **Votes des salariés** ouvre `/votes`. Il est disponible dans les démarches des chauffeurs et dans **Équipe & RH** pour les autres salariés. Les clients sont exclus. Le GPS et les documents opérationnels en attente ne conditionnent pas l'accès au vote ; des liens vers le module sont présents sur ces écrans de blocage.

## Organiser un scrutin

1. La direction choisit **Préparer un vote** et renseigne un titre, l'objet de la décision et la question posée.
2. Elle sélectionne les **participants** qui pourront consulter le scrutin et les documents, puis les **électeurs**, nécessairement parmi ces participants. Pour une élection, elle choisit les **candidats** parmi les participants. Un candidat unique est accepté. Les comptes désactivés, les clients et les comptes privés du droit de vote ne sont pas proposés.
3. Elle définit les choix, leur nombre maximum par bulletin, le vote blanc, le quorum, la confidentialité et le calendrier. Les dates sont saisies et affichées à l'heure de La Réunion.
4. Elle enregistre le brouillon, joint les documents et vérifie le récapitulatif. Les documents peuvent être visibles par les participants ou réservés à la direction.
5. **Publier le scrutin** fige son objet, ses choix, les personnes sélectionnées, ses règles, ses dates et ses pièces jointes. Un vote programmé s'ouvre à l'heure prévue ; le serveur refuse tout bulletin reçu après l'heure limite. La direction clôture explicitement pour dépouiller. Une clôture anticipée impose un motif.
6. Après clôture, la direction consulte le tableau de résultats et le registre de participation, puis utilise **Exporter le tableau CSV** pour Excel ou LibreOffice.
7. Elle renseigne la présidence du scrutin, éventuellement le secrétariat, le lieu et les observations/décisions, puis **Finaliser le procès-verbal**. Le bouton **Télécharger le PV PDF** devient disponible. La finalisation fige ces informations ; les signatures sont à apposer sur le PDF. Les exemplaires signés peuvent ensuite être joints au scrutin.

Le CSV contient l'objet, les règles, la participation, les résultats et le registre de participation. Le PDF contient l'objet, la question, les dates, les règles, les responsables, les résultats, le quorum, les observations, les noms des annexes, les espaces de signature et une empreinte du contenu enregistré. Il gère plusieurs pages. Le moteur PDF n'est chargé qu'au téléchargement.

## Parcours du salarié

Le salarié ouvre un scrutin, lit **Pourquoi vote-t-on ?**, consulte les règles et les documents, choisit son bulletin puis vérifie sa sélection dans la confirmation. L'application affiche une référence et la date après la confirmation effective du serveur. Un double clic, deux onglets concurrents ou une nouvelle tentative après une réponse perdue ne créent jamais un second vote. Un participant sans droit de vote peut lire le scrutin et ses annexes autorisées.

Les votes ne sont pas mis en file d'attente hors connexion. En cas de connexion incertaine, **Vérifier le scrutin** permet de retrouver la confirmation déjà enregistrée ; une nouvelle tentative reste protégée contre les doublons.

## Décisions retenues

- **Périmètre : consultations internes et élections simples.** Ce module n'implémente pas un dispositif d'élection CSE certifié, les collèges électoraux, les listes syndicales, plusieurs tours ou une répartition de sièges. Aucun document modèle n'ayant été joint à la demande, le PV est un modèle interne générique ; un modèle existant peut être importé comme pièce jointe, sans extraction automatique de ses champs.
- **Secret par défaut.** Aucun choix individuel ni empreinte de choix n'est conservé dans le registre d'un vote secret. L'urne contient seulement les compteurs agrégés. Le registre séparé permet de savoir qui a voté et quand. Le mode nominatif existe, mais sa visibilité pour la direction est annoncée avant de voter.
- **Résultats après clôture.** La direction n'accède ni aux compteurs ni au registre de participation pendant le vote. Après clôture, les résultats et le registre sont réservés aux rôles direction, président et administrateur. Le secrétariat peut participer, mais n'a pas ces pouvoirs par défaut. Un droit personnalisé ne permet pas de transformer un rôle client ou salarié en organisateur ; la restriction de rôle est également appliquée au serveur.
- **Règles figées à la publication.** Pour corriger un scrutin publié, il faut l'annuler avec un motif et en créer un nouveau, éventuellement en le copiant. Le scrutin annulé et sa trace restent conservés. Un scrutin clôturé ne peut être ni rouvert ni annulé. Les modifications concurrentes de brouillon sont détectées.
- **Pas de proclamation automatique.** Les votes blancs participent au quorum mais pas aux bulletins exprimés. Le tableau signale un quorum non atteint ou une égalité. Avec plusieurs choix possibles, chaque pourcentage est rapporté aux bulletins exprimés. La décision et un éventuel départage restent à consigner par le bureau dans le PV.
- **Pièces jointes :** PDF, DOC, DOCX, JPEG ou PNG, 5 Mo par fichier, dix annexes et trois exemplaires signés. Les exemplaires signés disposent d'une capacité distincte pour ne pas être bloqués par les annexes. Les fichiers ne sont pas écrasables. Les téléchargements passent par une vérification serveur des destinataires et utilisent la génération exacte du fichier enregistré.
- **Limites explicites :** 500 participants et 50 choix/candidats par scrutin. Les scrutins sont chargés par pages de 30. La suppression d'une annexe de brouillon la retire du scrutin et de ses téléchargements ; elle ne supprime pas physiquement l'objet de stockage. Aucune purge automatique ni suppression de scrutin n'est disponible.
- **Traçabilité :** création, modification, publication, clôture, annulation, documents et finalisation du PV produisent des événements réservés au serveur dans le journal existant. Aucun choix secret n'est ajouté au journal.

## Garanties et limites techniques

Firestore refuse l'accès direct aux scrutins, compteurs et participations, y compris depuis un compte direction. La fonction `employeeVoting` contrôle les sessions actives, les rôles, les droits, l'appartenance au scrutin et le calendrier. L'enregistrement du bulletin, du reçu et des compteurs est atomique. La clôture contrôle la cohérence entre compteurs et participations. Le CSV neutralise les formules dans les valeurs textuelles.

Le secret décrit ici concerne l'application et les données individuelles qu'elle expose. Il ne constitue pas une urne cryptographique indépendante de l'administrateur de l'infrastructure. Le stockage agrégé ne permet pas un recomptage bulletin par bulletin d'un scrutin secret ; les résultats agrégés et le nombre de participations sont contrôlés à la clôture. Des petits effectifs ou des résultats unanimes peuvent permettre des déductions. L'empreinte SHA-256 du PV est une référence d'intégrité du contenu figé ; ce n'est pas une signature électronique certifiée ni une preuve indépendante de l'administrateur technique.

Aucun scrutin réel, aucun bulletin réel et aucune notification adressée aux salariés n'ont été créés pour valider cette livraison. Les élus, règles particulières et modèles de document restent sous le contrôle de la direction.

Voir la [recette et les exemples fictifs](../validation/voting/README.md).
