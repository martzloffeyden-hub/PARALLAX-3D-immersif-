# PARALLAX — Rapport de tests

Ce rapport ne contient **que des tests réellement exécutés**, avec leurs résultats bruts. Ce qui n'a
pas pu être vérifié est listé explicitement à la fin.

## 1. Environnement de test

| | |
|---|---|
| Machine | Conteneur Linux, 4 cœurs, 15 Go de RAM, **aucun GPU** |
| Navigateur | Chromium 141 (build Playwright 1194), sans écran (*headless*) |
| WebGL | WebGL 2 via ANGLE → **SwiftShader** (rendu logiciel sur le processeur) |
| Pilotage | Playwright (`playwright-core` 1.64), scripts du dossier `tests/` |
| Version testée | build de production `dist/PARALLAX.html` (fichier unique, 909 Ko), servi en HTTP local **et** ouvert en `file://` |

Conséquence importante : le rendu logiciel est 50 à 200 fois plus lent qu'un GPU. Les tests valident
le **fonctionnement** (scènes, mécaniques, transitions, erreurs, son), **pas la fluidité**. Pour que les
séquences avancent malgré la lenteur, certains tests accélèrent le temps de jeu (×1,5 à ×3) via
l'interface de test.

## 2. Résultats

### 2.1 Compilation
* `npm run typecheck` (TypeScript strict) : **0 erreur**.
* `npm run build` : **réussi**, un seul fichier `dist/PARALLAX.html` de 909 Ko (polices et code inclus).

### 2.2 Ouverture du fichier unique en `file://` (comme sur Windows par double-clic)
Script ad hoc (Chromium, `file:///…/dist/PARALLAX.html`) :
* chargement complet jusqu'à la porte « Entrer » : **OK** ;
* clic → écran-titre, audio actif : **OK** ;
* 5 polices embarquées chargées (Cormorant 300/300 italique/500, Plex Mono 300/400) : **OK** ;
* contexte sécurisé : **oui** ; `localStorage` (réglages, progression) : **fonctionne** ;
* aucune requête réseau échouée, **console vide**.

### 2.3 Parcours de l'interface avec de vrais clics — `tests/ui-flow.mjs`
| Vérification | Résultat |
|---|---|
| Écran de chargement affiché | OK |
| Chargement terminé → porte « Entrer » | OK |
| Clic sur « Entrer » → écran-titre | OK |
| Audio initialisé après le geste utilisateur | OK |
| Musique du titre audible | OK (crête 0,21) |
| Pas d'écrêtage | OK |
| Paramètres → changement de profil graphique appliqué à chaud | OK |
| Fermeture du panneau | OK |
| « Commencer » → plongée → chapitre I jouable | OK |
| Menu de pause | OK |
| « Reprendre » | OK |
| Ambiance sonore du chapitre I audible | OK (crête 0,23) |
| Aucune erreur applicative, console sans avertissement | OK |

**13 / 13.**

### 2.4 Parcours complet, de bout en bout — `tests/playthrough.mjs` (avec audio actif)
Le script joue réellement l'expérience à travers les mécaniques du jeu : il place le joueur au point
de vue, maintient l'action « observer » (le verrouillage, le glissement magnétique et les séquences
sont ceux du jeu), puis **marche** au clavier simulé (touche W) pour traverser les portails et les
seuils de gravité.

| Étape | Résultat | Durée (temps réel, ×3) |
|---|---|---|
| I — verrouillage du cercle | OK | 2,8 s |
| I — séquence du Seuil (anneau → Grande Porte, portail ouvert) | OK | 23,4 s |
| I → II — traversée du portail (permutation sans coupure) | OK | 2,3 s |
| II — verrouillage du pont | OK | 3,9 s |
| II — pont assemblé, collisions actives | OK | 23,2 s |
| II — bascule de gravité sur la paroi (en marchant) | OK | 2,5 s |
| II — bascule au sommet (en marchant) | OK | 0,8 s |
| II — Porte de la Nuit, tombée de la nuit, chemin de pierre | OK | 30,0 s |
| II → III — traversée de la Porte (en marchant) | OK | 4,9 s |
| III — marche sur la chaussée | OK | 3,4 s |
| III — convergence, finale synchronisé, générique | OK | 39,1 s |

**11 / 11**, **0 erreur** (erreurs applicatives, erreurs de séquence et erreurs audio comptées),
console sans erreur ni avertissement. Le même parcours sans audio passe aussi (11 / 11).

### 2.5 Mixage audio — `tests/audio-mix.mjs`
Niveaux mesurés en sortie du limiteur (volumes par défaut : général 80 %, musique 75 %, effets 85 %) :

| Moment | RMS moyen | Crête |
|---|---|---|
| Titre (musique + ambiance) | −24,3 dBFS | −12,8 dBFS |
| Chapitre I — ambiance | −23,3 dBFS | −10,6 dBFS |
| Chapitre I — près du point de vue (accord) | −22,3 dBFS | −11,2 dBFS |
| Chapitre I — verrouillage et séquence | −19,6 dBFS | −6,0 dBFS |
| Chapitre II — ambiance | −20,7 dBFS | −6,3 dBFS |
| Chapitre III — pulsation (intensité 0,9) | −20,9 dBFS | −7,0 dBFS |
| Finale — montée | −20,5 dBFS | −1,1 dBFS |
| Finale — sommet et coda | −18,4 dBFS | −2,5 dBFS |

Crête maximale observée : **0,88** (pas d'écrêtage), **aucune valeur invalide (NaN)**, aucune erreur.
La dynamique suit l'intention : l'intensité monte jusqu'au finale.

### 2.6 Contrôle visuel et coût de rendu — `tests/gallery.mjs` (profil « Élevée »)
15 vues fixes rendues et examinées (captures dans `docs/images/`). Coût mesuré par image :

| Vue | Appels de dessin | Triangles |
|---|---|---|
| Titre | 16 | 104 k |
| Chapitre I (4 vues) | 18 – 29 | 23 – 36 k |
| Chapitre II (6 vues) | 25 – 32 | 62 – 74 k |
| Chapitre III (4 vues) | 27 – 30 | 49 – 66 k |

Environ 70 programmes de shaders, tous compilés pendant l'écran de chargement.

### 2.7 Séquences examinées image par image
`tests/sequence-shots.mjs`, `tests/finale-shots.mjs` et des captures ad hoc ont servi à relire le
cadrage et le rythme : verrouillage et envol de l'emblème (I), assemblage du pont (II), bascule de
gravité (II), Porte de la Nuit et tombée de la nuit (II), finale et générique (III).

## 3. Défauts trouvés par ces tests, puis corrigés

| Défaut | Gravité | Correction |
|---|---|---|
| L'instrument « timbale » arrêtait un oscillateur avant de le démarrer → exception. Au chapitre I, elle aurait empêché **l'ouverture du portail** (blocage de la partie) ; au chapitre III, elle cassait la pulsation. | Critique | Ordre corrigé ; chaque effet d'une séquence et la musique sont désormais isolés : une erreur d'effet ne peut plus bloquer la progression. |
| Socle de la Grande Porte haut de 0,7 m (> 0,45 m franchissable) : impossible d'atteindre le portail. | Critique | Marche abaissée à 0,32 m, seuil d'arrivée assorti au chapitre II. |
| Pause par la touche P : le pointeur restait capturé, le menu ne recevait pas les clics. | Majeure | La pause libère toujours le pointeur. |
| Pièces instanciées rendues noires (couleurs de sommet manquantes). | Majeure | Attribut de couleur ajouté. |
| Point de vue de la Porte de la Nuit dans l'axe d'arrivée : la figure était déjà alignée en arrivant. | Majeure (conception) | Point de vue déplacé à l'angle du sommet. |
| Bascule de gravité « nez au mur », illisible. | Moyenne | Seuil reculé de 4 m, arc de caméra qui s'écarte pendant la rotation. |
| Générique illisible sur l'aube surexposée. | Moyenne | Exposition revue, mise en page recomposée autour de l'emblème. |
| Boucle de rétroaction WebGL dans la passe de profondeur de la peinture. | Moyenne | Matériau neutre pendant cette passe. |
| Coulures de pierre en fines rayures (aspect bois). | Esthétique | Taches larges et douces. |
| Chapitre III à ~290 k triangles (éclats biseautés invisibles à 500 m). | Performance | Géométrie simple : 49 – 66 k triangles. |

## 4. Ce qui n'a PAS pu être testé

* **Fluidité réelle sur l'ASUS Vivobook 17 (Iris Xe)** : aucun GPU n'était disponible. Aucune valeur
  d'images par seconde n'est donc annoncée. Les choix (16 à 32 appels de dessin, ombres recalculées
  à la demande, reflets et portails à résolution réduite, résolution adaptative, trois profils) visent
  un GPU intégré, mais la fluidité doit être confirmée sur la machine (option « Afficher les performances »).
* **Durée de compilation des shaders sous Windows** (Direct3D 11 via ANGLE).
* **Écoute** : le son a été validé par mesure, pas à l'oreille.
* **Sensation des commandes** (sensibilité de la souris, inertie) avec une vraie souris et un vrai
  verrouillage du pointeur : les tests ont piloté le joueur par l'interface de test.
* **Manette** réelle, écrans haute densité, configurations multi-écrans.
* **Navigateurs autres que Chromium** (Firefox, Safari) : non testés ; la cible est Chrome sous Windows 11.

## 5. Rejouer les tests

```bash
npm install && npm run build
npx vite preview --port 4173 &
node tests/ui-flow.mjs
AUDIO=1 BASE=http://localhost:4173/PARALLAX.html node tests/playthrough.mjs
node tests/audio-mix.mjs
node tests/gallery.mjs
```
Sous Windows, les tests peuvent utiliser le Chrome installé et **le vrai GPU** :
`set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe` puis `set GPU=1` avant de lancer
un script (par exemple `node tests/gallery.mjs`, qui relève aussi le coût de rendu).
