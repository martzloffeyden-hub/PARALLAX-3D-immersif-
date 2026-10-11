# PARALLAX — Document de conception

> *Le monde n'existe que sous un certain angle.*

## 1. Intention

**Parallaxe** : déplacement apparent d'un objet lorsque l'on change de point de vue.
PARALLAX fait de cette idée sa mécanique, son esthétique et son récit :
le monde a été brisé en fragments qui ne prennent sens que depuis **un seul point de vue**.
Le joueur — l'Observateur — n'a ni arme ni inventaire. Il n'a que son regard.
Chaque fois qu'il trouve le bon angle, ce qu'il *perçoit* devient *réel*.

L'expérience dure de 4 à 8 minutes selon le joueur, se termine par un final audiovisuel
synchronisé, et reste explorable librement ensuite.

## 2. Identité artistique — « minimalisme métaphysique »

| Référence | Ce que nous en retenons |
|---|---|
| Giorgio de Chirico (piazze métaphysiques) | Ombres longues, arcades ocre, horizon bas, ciel vert-bleu, silence |
| Felice Varini (anamorphoses peintes) | Une forme géométrique peinte à travers l'architecture, qui ne se recompose que depuis un point |
| James Turrell | La lumière comme matière, les champs colorés du ciel |
| Tadao Ando / Étienne-Louis Boullée | Volumes purs, pierre claire, échelle monumentale |
| M. C. Escher | Gravité relative, architecture impossible |

**Règles visuelles**

* Une matière : la **pierre claire** aux arêtes biseautées qui accrochent la lumière, avec joints,
  assises, coulures et salissures discrètes.
* Une couleur signature : le **vermillon** — la couleur du « vrai point de vue ». Tout ce qui est
  vermillon guide ou peut s'aligner.
* Un ciel qui raconte le temps : **après-midi → heure bleue → nuit → aube**. L'arc du jour est l'arc émotionnel.
* Pas de particules gratuites : poussière dans la lumière (échelle et air), poussière soulevée par la
  pierre qui bouge, pierres suspendues (le monde brisé), étoiles reflétées (vertige).
* L'atmosphère fond les lointains dans le ciel : le brouillard utilise la couleur exacte du ciel dans
  la direction du regard, avec diffusion vers le soleil.

**Emblème** : un cercle coupé par une ligne d'horizon — le soleil posé sur l'horizon, moitié réel,
moitié reflet. Il apparaît au chargement, il est la figure peinte du chapitre I, il devient le portail
de la Grande Porte, et c'est **littéralement l'image finale** : l'anneau d'éclats et son reflet dans
l'eau, coupés par l'horizon, avec le soleil levant en son centre.

**Typographie** : *Cormorant Garamond* (sérif d'affichage, italiques) + *IBM Plex Mono*
(annotations techniques en capitales espacées, comme des cartels de musée). Licence SIL OFL, embarquées.

## 3. Déroulement

| # | Chapitre | Lumière | Mécanique | Moment fort |
|---|---|---|---|---|
| 0 | **Titre** | Crépuscule sombre | Le mot PARALLAX est une sculpture d'éclats dispersés en profondeur ; il n'est lisible que depuis la caméra. La souris déplace le point de vue et le mot se disloque. | Le titre se compose sous vos yeux ; « Commencer » plonge à travers les lettres. |
| I | **Le Seuil** | Après-midi doré | Anamorphose peinte : l'emblème vermillon éclaté sur colonnes, murs, sol. Point de vue : un belvédère au disque de bronze. | La peinture s'embrase, se détache en anneau de lumière ; la composition s'enfonce dans le sol ; l'anneau vole jusqu'à la Grande Porte où il s'inscrit comme une porte de lune et s'ouvre sur l'Archipel. |
| II | **L'Archipel** | Heure bleue → nuit | 1) Anamorphose d'éclats : des pierres suspendues forment un pont depuis une terrasse. 2) Seuil de gravité : on marche sur la paroi d'un monolithe. 3) Anamorphose de la Porte de la Nuit au sommet. | Le pont s'assemble pierre par pierre (chaque dalle joue une note) ; le monde bascule de 90° ; au sommet, une arche géante s'assemble dans le ciel, la nuit tombe, un chemin de pierre monte des nuages. |
| III | **Le Point de fuite** | Nuit → aube | Une chaussée sur une eau-miroir. Deux anneaux d'éclats décalés (parallaxe binoculaire) convergent à mesure qu'on avance ; les obélisques s'allument au passage, chacun avec sa note. | Les anneaux fusionnent ; l'aube remonte la chaussée en rythme ; l'anneau et son reflet composent l'emblème. Générique sur l'image finale, puis *Exploration libre*, *Rejouer* ou *Menu principal*. |

### Verbe principal : OBSERVER
* Se déplacer (ZQSD / WASD / flèches), regarder (souris), courir (Maj).
* **Maintenir le clic** (ou Espace / E / gâchette) = observer : le pas ralentit, le champ se resserre,
  la périphérie s'assombrit et se désature. Si l'alignement est suffisant, le regard « se fixe » :
  la caméra glisse magnétiquement vers le point exact et l'anamorphose se verrouille.

### Retours d'alignement
1. **Visuel intrinsèque** — les fragments se rejoignent réellement à l'écran.
2. **Sonore** — chaque anamorphose émet un accord spatialisé dont les voix sont désaccordées
   proportionnellement au défaut d'alignement : les battements ralentissent à l'approche et l'accord
   devient pur au point exact.
3. **Interface discrète** — un arc autour du réticule et la cote « ALIGNEMENT 0.82 ».
4. **Monde vivant** — les pierres suspendues se calment quand on approche du bon regard.

### Rythme et aide
Indices progressifs (désactivables) si le joueur ne progresse pas : texte poétique, puis indication
de plus en plus précise. Chute dans le vide = retour doux au dernier sol sûr. Progression sauvegardée
par chapitre (« Continuer », sélection de chapitre).

## 4. Son

Entièrement synthétisé en temps réel (Web Audio API), aucune ressource externe.
* Bus musique / ambiances / effets → compresseur → limiteur ; réverbération par convolution avec
  réponses impulsionnelles générées (une taille d'espace par chapitre) ; écho ping-pong.
* Musique générative : titre et chapitre I en ré lydien, chapitre II en si mineur (nappes à anches),
  chapitre III en la dorien avec pulsation croissante, **finale en ré majeur** (retour à la tonalité
  du Seuil), écrit au temps près et synchronisé avec l'image via l'horloge audio.
* Effets : accord d'alignement (HRTF), verrouillage (impact, cloches FM, nappe), pierres accordées,
  grondements, souffles, bascule de gravité, pas, interface.

## 5. Architecture technique

* **Three.js r186 / WebGL2**, TypeScript, Vite. Build en **un seul fichier HTML** autonome.
* Rendu HDR (RGBA16F, MSAA optionnel) → bloom à double filtre → composite unique (exposition,
  AgX avec « look », étalonnage lift/gamma/gain, vignettage, aberration chromatique, grain) → FXAA optionnel.
* Matériaux PBR étendus par `onBeforeCompile` : atmosphère partagée avec le ciel, pierre procédurale
  (variation, rugosité, relief), dallage, assises, coulures, projection de peinture anamorphique avec
  test de visibilité (carte de profondeur), occlusion de contact, ombre de contact vue du dessus,
  ombres de nuages mouvantes.
* Géométries procédurales fusionnées par matériau : 16 à 32 appels de dessin par image.
* Ombres : une lumière directionnelle par chapitre, carte recalculée seulement quand quelque chose bouge.
* Portails (rendu de la scène de destination avec plan de coupe oblique), eau-miroir (réflexion plane
  à résolution réduite), mer de nuages (champ de hauteur avec parallaxe), oiseaux et particules
  animés dans les shaders.
* Gravité : chaque zone de marche appartient à un *référentiel* ; la bascule interpole la pose monde
  de la caméra avec un arc qui la fait s'écarter de la paroi.
* Robustesse : une erreur dans un effet (son, particules) ne peut pas bloquer une séquence ; perte de
  contexte WebGL gérée ; progression sauvegardée.
