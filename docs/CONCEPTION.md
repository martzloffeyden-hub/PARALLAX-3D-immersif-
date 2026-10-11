# PARALLAX — Document de conception

> *Le monde n'existe que sous un certain angle.*

## 1. Intention

**Parallaxe** : déplacement apparent d'un objet lorsque l'on change de point de vue.
PARALLAX fait de cette idée sa mécanique, son esthétique et son récit :
le monde a été brisé en fragments qui ne prennent sens que depuis **un seul point de vue**.
Le joueur — l'Observateur — n'a ni arme ni inventaire. Il n'a que son regard.
Chaque fois qu'il trouve le bon angle, ce qu'il *perçoit* devient *réel*.

L'expérience dure de 3 à 6 minutes, se termine par un final audiovisuel synchronisé,
et reste explorable librement ensuite.

## 2. Identité artistique — « minimalisme métaphysique »

| Référence | Ce que nous en retenons |
|---|---|
| Giorgio de Chirico (piazze métaphysiques) | Ombres longues, arcades, horizon bas, silence, mystère |
| Felice Varini (anamorphoses peintes) | Une forme géométrique peinte à travers l'architecture, qui ne se recompose que depuis un point |
| James Turrell | La lumière comme matière, les champs colorés du ciel |
| Tadao Ando / Étienne-Louis Boullée | Volumes purs, béton/pierre claire, échelle monumentale |
| M. C. Escher | Gravité relative, architecture impossible |

**Règles visuelles**

* Une matière : la **pierre claire** (os, calcaire, travertin) aux arêtes biseautées qui accrochent la lumière.
* Une couleur signature : le **vermillon** — c'est la couleur du « vrai point de vue ». Tout ce qui est vermillon peut s'aligner.
* Un ciel qui raconte le temps : **après-midi → crépuscule → nuit → aube**. L'arc du jour est l'arc émotionnel.
* Pas de particules gratuites : chaque effet a une fonction (poussière dans la lumière = échelle et air ; éclats = monde brisé ; étoiles reflétées = vertige).
* L'atmosphère (perspective aérienne) fond les lointains dans le ciel : le brouillard utilise **exactement** la couleur du ciel dans la direction du regard, avec diffusion vers le soleil.

**Emblème** : un cercle coupé par une ligne d'horizon — le soleil posé sur l'horizon,
moitié réel, moitié reflet. Il apparaît au chargement, sur l'écran-titre, et devient
littéralement l'image finale de l'expérience.

**Typographie** : *Cormorant Garamond* (sérif d'affichage, poétique, italiques) +
*IBM Plex Mono* (annotations techniques en capitales espacées, comme des cartels de musée
ou des cotes de dessin d'architecte). Polices sous licence SIL OFL, embarquées.

## 3. Déroulement

| # | Chapitre | Lumière | Mécanique | Moment « WOW » |
|---|---|---|---|---|
| 0 | **Écran-titre** | Crépuscule chaud | Le mot PARALLAX est une sculpture d'éclats dispersés en 3D ; il n'est lisible que depuis la caméra. La souris déplace le regard et le mot se disloque. | Le titre se compose sous vos yeux. |
| I | **Le Seuil** | Après-midi doré | Anamorphose peinte (à la Varini) : un cercle vermillon éclaté sur colonnes, murs et sol. | Le cercle peint se détache de l'architecture, devient un anneau de lumière, les murs s'enfoncent dans le sol, l'anneau devient un **portail** vers le chapitre II. |
| II | **L'Archipel** | Heure bleue | Anamorphose d'éclats : des blocs flottants forment un pont depuis le bon point de vue. Puis seuils de gravité. | Le pont s'assemble pierre par pierre, chaque pierre jouant une note. Puis le monde **bascule de 90°** : on marche sur la paroi d'un monolithe de 100 m. Au sommet, la nuit tombe en quelques secondes. |
| III | **Le Point de Fuite** | Nuit → aube | Une chaussée sur une eau-miroir, vers le point de fuite. Deux anneaux d'éclats décalés (parallaxe binoculaire) convergent à mesure qu'on avance. | Les deux anneaux fusionnent. Le point de lumière devient soleil, l'aube remonte la chaussée en rythme avec la musique, et l'anneau et son reflet composent l'emblème. |
| — | **Épilogue** | Aube | Retour au Seuil, désormais entier. | Générique, puis *Recommencer* ou *Exploration libre*. |

### Verbe principal : OBSERVER
* Se déplacer (ZQSD / WASD / flèches), regarder (souris).
* **Maintenir le clic** = observer : le pas ralentit, le champ se resserre légèrement, la périphérie s'assombrit,
  le son d'alignement est amplifié. Si l'alignement est suffisant, le regard « se fixe » :
  la caméra glisse magnétiquement vers le point exact et l'anamorphose se verrouille.

### Retours d'alignement (sans interface envahissante)
1. **Visuel intrinsèque** — les fragments se rejoignent réellement à l'écran.
2. **Sonore** — chaque anamorphose émet un accord spatialisé dont les voix sont désaccordées
   proportionnellement au défaut d'alignement : les battements ralentissent à l'approche
   et l'accord devient pur au point exact. On peut littéralement trouver le point *à l'oreille*.
3. **Interface discrète** — un anneau fin autour du réticule et une cote « ALIGNEMENT 0.82 ».
4. **Monde vivant** — les éclats flottants se calment quand on approche du bon regard.

### Rythme et aide
Indices progressifs (désactivables) si le joueur ne progresse pas : texte poétique puis
repère visuel plus marqué. Chute dans le vide = retour doux au dernier sol sûr.

## 4. Son

Entièrement synthétisé en temps réel (Web Audio API), aucune ressource externe.
* Bus : musique / ambiances / effets → compresseur → limiteur. Réverbération par convolution
  avec réponses impulsionnelles générées procéduralement (une par chapitre).
* Musique générative par chapitre : I en ré lydien (lumineux, mystérieux), II en si mineur avec
  ostinato, III en la dorien qui monte en pulsation et **résout en ré majeur** au final
  (retour à la tonalité du Seuil).
* Sons d'interaction : accord d'alignement spatialisé (HRTF), verrouillage (impact + cloches FM),
  pierres accordées du pont (arpège), grondements, vent, pas sur la pierre, interface.
* Les événements visuels synchronisés sont pilotés par l'horloge audio.

## 5. Architecture technique

* **Three.js r186 / WebGL2**, TypeScript, Vite. Build en **un seul fichier HTML** autonome
  (ouvrable par double-clic, aucun serveur, aucun service tiers).
* Rendu HDR (RGBA16F, MSAA optionnel) → bloom à double filtre (chaîne de mips) →
  composite unique (exposition, tone mapping filmique, étalonnage par chapitre, vignettage,
  aberration chromatique légère, grain) → FXAA optionnel.
* Matériaux PBR (MeshStandardMaterial) étendus par `onBeforeCompile` : position monde,
  brouillard atmosphérique physique partagé avec le ciel, projection de peinture anamorphique
  avec test de visibilité (carte de profondeur depuis le point de vue), occlusion de contact au sol.
* Textures de pierre générées sur GPU au chargement (bruit périodique) ; géométries
  architecturales procédurales (boîtes biseautées, arcades extrudées, colonnes tournées)
  fusionnées par matériau pour réduire les appels de dessin.
* Ombres : une lumière directionnelle par chapitre, carte d'ombre **mise à jour seulement quand
  quelque chose bouge** (gros gain sur GPU intégré).
* Portails : rendu de la scène de destination dans une texture à résolution réduite, avec plan
  de coupe oblique, puis permutation sans couture quand on traverse.
* Gravité : chaque zone de marche appartient à un *référentiel* ; changer de référentiel fait
  pivoter la caméra autour du joueur.
* Contrôleur de personnage maison (cylindre contre boîtes orientées / cylindres), marches
  automatiques, lissage de la hauteur des yeux, balancement de tête, inertie.

## 6. Profils graphiques (cible : Intel Core i7-1255U, Iris Xe intégré)

| | Élevée | Équilibrée (défaut Iris Xe) | Performances |
|---|---|---|---|
| Résolution interne | 100 % | 85 % (adaptative 65–100 %) | 70 % (adaptative 50–85 %) |
| Anticrénelage | MSAA 4× | FXAA | FXAA |
| Ombres | 2048, douces | 2048, douces | 1024, plus dures |
| Bloom | 6 niveaux | 5 niveaux | 4 niveaux |
| Reflets de l'eau (III) | ½ résolution | ¼ résolution | réflexion d'environnement |
| Particules / éclats | 100 % | 70 % | 45 % |
