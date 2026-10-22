# IA Vidéo — applications Android

Ce dépôt contient deux applications Android compilées automatiquement par GitHub Actions :

| Application | Dossier | Description |
| --- | --- | --- |
| **CINÉ-GENESIS** | `film/` | Studio de création IA : images 4K, vidéos 4K (Kling 3.0, LTX-2.3, Veo 3.1…) et films complets montés en 4K sur le téléphone. |
| **Nova Graph** | `app/` | Calculatrice graphique hors ligne. |
| **Trouve ton IA** | `trouve/` | Studio gratuit qui crée tes vidéos et images IA dans l'appli, catalogue de plus de 1000 IA expliquées en français et comparateur de générateurs vidéo. |

## Télécharger les APK

À chaque push, le workflow **APK Android** compile, signe et publie les deux APK dans la version
[**apk-latest**](../../releases/tag/apk-latest) (lien fixe, toujours à jour) :

- `CineGenesis.apk` — `https://github.com/Idrissta/ia-video/releases/download/apk-latest/CineGenesis.apk`
- `NovaGraph.apk` — `https://github.com/Idrissta/ia-video/releases/download/apk-latest/NovaGraph.apk`

Ouvrez le lien depuis le téléphone, puis le fichier `.apk`, et autorisez l'installation depuis cette source si Android le demande
(Android 8.0 ou plus récent). Les APK sont aussi disponibles comme artefacts de chaque exécution (onglet **Actions**),
et un tag `v*` crée une *Release* versionnée.

**Trouve ton IA** a son propre workflow (**APK Trouve ton IA**) et sa propre version [**trouve-latest**](../../releases/tag/trouve-latest) :

- `TrouveTonIA.apk` — `https://github.com/Idrissta/ia-video/releases/download/trouve-latest/TrouveTonIA.apk`

---

# Trouve ton IA — le catalogue des IA, en français

Application Android gratuite, sans publicité et sans compte, qui **crée elle-même tes vidéos et images IA** et t'aide à
trouver l'IA qu'il te faut : décris ce que tu veux faire (« enlever le fond d'une photo », « créer une chanson »,
« réviser mon bac »…) et l'appli te propose les bons outils, avec pour chacun ce qui est vraiment gratuit, le prix, les
plateformes et les alternatives.

<p align="center">
  <img src="docs/trouve-accueil.png" width="220" alt="Accueil de Trouve ton IA">
  <img src="docs/trouve-creer.png" width="220" alt="Studio : créer une vidéo IA">
  <img src="docs/trouve-recherche.png" width="220" alt="Recherche en langage naturel">
  <img src="docs/trouve-videos.png" width="220" alt="Comparateur de générateurs vidéo">
</p>

### Fonctionnalités

- **Studio « Créer »** (onglet du milieu) : tu décris ta vidéo, l'appli fait tout, gratuitement et sans compte.
  1. une IA écrit le scénario (titre, voix off de chaque scène, description des images) ;
  2. les images sont créées en parallèle par **Pollinations** et **AI Horde** (GPU de bénévoles) ;
  3. option **« Animer avec une vraie IA vidéo »** : chaque image devient un clip IA de 3 s avec **LTX-Video**
     (Lightricks, sur Hugging Face), environ 10 s par scène, dans la limite du quota gratuit du serveur ;
  4. le téléphone monte la vidéo : mouvements de caméra, fondus, titre, sous-titres façon TikTok, **voix off en
     français** (synthèse vocale d'Android) et **musique composée dans l'appli** (calme, joyeuse, épique, énergique,
     lo-fi, mystère) ;
  5. la vidéo (MP4 si le téléphone le permet) s'enregistre dans la galerie (Films › Trouve ton IA) et se partage.
  Formats 9:16 (TikTok, Shorts, Reels), 16:9 (YouTube) et 1:1 ; 3, 5 ou 8 scènes ; 8 styles (cinéma, réaliste, anime,
  dessin animé 3D, aquarelle, BD, fantastique, pixel art). Après le montage : changer la musique, les textes, refaire une
  image ou l'animer, puis remonter. Mode **Image** : 1 à 4 images à enregistrer, ou à animer en vidéo.
- **Les IA s'ouvrent dans l'appli**, dans un navigateur intégré (barre pour fermer, recharger ou passer dans Chrome) :
  créer sur Kling, PixVerse, Vidu, Dreamina, Hailuo ou Flow avec leurs crédits gratuits du jour, envoyer une photo,
  télécharger ses créations (Téléchargements › Trouve ton IA), rester connecté. Google n'autorisant pas la connexion à un
  compte Google dans une autre appli, l'appli conseille l'e-mail ou propose Chrome. Réglable pour ouvrir Chrome à la place.
- **Plus de 1000 IA** dans 25 catégories (assistants, images, vidéo, montage, voix, musique, études, code, sites sans coder,
  3D, santé et sport, vie quotidienne, argent et droit, IA privées sur ton appareil…), chacune avec une fiche en français :
  résumé, ce qui est gratuit, tarif indicatif, plateformes, alternatives, et pour les plus connues points forts et limites.
- **Comparateur de générateurs vidéo** : 45 générateurs (Kling, Veo/Flow, Sora, Runway, Hailuo, PixVerse, Vidu, Dreamina,
  Wan, LTX, FramePack…) classés par qualité, vitesse ou gratuité, avec filtres « gratuit », « rapides », « son intégré »,
  « photo → vidéo », « 4K », « Android », « open source / PC ». Chaque fiche vidéo indique définition, durée d'un clip,
  son, vitesse et départ texte ou image. Une recherche comme « vidéo IA gratuite et rapide » met les plus rapides en tête.
- **Recherche en langage naturel** hors ligne : accents, pluriels, synonymes (« diapo » → présentation), fautes de frappe
  (« chatgtp », « mid journey ») et intentions (« gratuit », « sans compte », « sur mon téléphone », « hors ligne »)
  qui proposent automatiquement le bon filtre.
- **Parcours pas à pas** : créer une vidéo YouTube, faire une vidéo IA gratuite et rapide, composer une chanson, réaliser un court-métrage IA, réviser un examen,
  lancer sa marque, créer une appli sans coder, vendre en ligne, décrocher un emploi.
- **Sélections** : 100 % gratuites, vidéo IA gratuite, sans inscription, applis Android, open source, made in France,
  coups de cœur, et des sélections **« Pour qui ? »** (étudiants, enseignants, créateurs, vendeurs, développeurs, artistes,
  musiciens, pros, famille).
- **Filtres et tri** (gratuit, version gratuite, sans compte, Android, en français, open source), **favoris**,
  **comparateur** jusqu'à 3 outils, historique des recherches, partage d'une fiche, thème sombre ou clair.
- **Fonctionne hors ligne** : le catalogue est intégré à l'APK. Il se **met à jour tout seul** (au plus deux fois par jour)
  depuis `trouve/src/main/assets/web/data/catalogue.json` sur la branche `master` du dépôt : ajouter une IA dans ce
  fichier et augmenter `version` suffit pour qu'elle apparaisse chez tout le monde, sans réinstaller l'appli.
- Réseau limité : la page de l'appli ne contacte que le catalogue du dépôt et le service de logos de DuckDuckGo
  (désactivable) ; le studio passe par la partie native, limitée aux générateurs gratuits (Pollinations, AI Horde,
  Hugging Face). Les services gratuits ont leurs limites : une image toutes les 45 s par appareil chez Pollinations
  (avec un petit logo), file d'attente variable chez AI Horde, quelques clips par jour sur LTX-Video. Leur disponibilité
  est vérifiée par le workflow **Sonde des générateurs gratuits** (`tools/trouve-recherche/sonder.js`).

### Architecture

```
trouve/src/main/
├── java/com/idrissta/trouvetonia/MainActivity.java   coque native : WebView plein écran, partage, retour
├── java/com/idrissta/trouvetonia/NavigateurActivity.java  navigateur intégré pour les sites des IA
├── java/com/idrissta/trouvetonia/Studio.java         studio : réseau des générateurs, cache, voix off, galerie
└── assets/web/
    ├── index.html, css/app.css
    ├── data/catalogue.json   catégories, sélections, parcours et outils (un outil par ligne)
    ├── js/search.js          moteur de recherche en français (aussi utilisé par les tests Node)
    ├── js/store.js           favoris, réglages, chargement et mise à jour du catalogue
    ├── js/app.js             écrans, navigation et interactions
    ├── js/natif.js           accès aux outils natifs (avec équivalents navigateur pour le développement)
    ├── js/generateurs.js     Pollinations, AI Horde et LTX-Video : scénario, images, clips, répartition
    ├── js/montage.js         montage sur canvas, musique synthétisée, enregistrement vidéo
    └── js/studio.js          écrans « Créer » et atelier
```

Les fiches sont rédigées en français pour l'appli. Les nouveaux outils ont été repérés dans notre propre liste et dans
des listes publiques sur GitHub (steven2358/awesome-generative-ai, filipecalegario/awesome-generative-ai,
mahseema/awesome-ai-tools, eudk/awesome-ai-tools — seuls les noms et adresses ont servi), puis leurs sites officiels visités un par un par le workflow **Trouve ton IA — recherche** (`tools/trouve-recherche/`, résultats
dans `resultats.json`) ; les sites injoignables ou fermés ont été écartés. Prix et caractéristiques vidéo sont indicatifs :
ils changent vite, l'appli invite à vérifier sur le site officiel.

Développer dans un navigateur : `python3 -m http.server 8000 -d trouve/src/main/assets/web`.
Tests : `node tools/test-trouve.js` (validité du catalogue et pertinence de la recherche) ;
`node tools/trouve-liens.js` vérifie que les sites officiels répondent (réseau requis).

---

# CINÉ-GENESIS — studio de films IA en 4K

Version Android de l'application web « CINÉ-GENESIS · Studio de films IA », repensée pour rivaliser avec
Kling AI et Leonardo AI : interface sombre et cinématographique, images jusqu'à 4096 px et vidéos en **4K UHD (3840×2160)**.

### Ce que fait l'application

- **Studio** — création rapide façon Kling / Leonardo :
  - *Image* : prompt + « ✦ Magic prompt », styles, jusqu'à 4 images de référence, formats 16:9 / 9:16 / 1:1 / 4:3 / 3:4,
    1 à 4 variantes. Modèles **Seedream 4.5** (4K natif, jusqu'à 4096 px) et **Nano Banana Pro** (4K), ou Agnès Image.
  - *Vidéo* : image de départ (importée, prise dans la galerie ou générée automatiquement), durée, son natif,
    réplique parlée en français. Modèles **Kling 3.0 4K** et **LTX-2.3 Pro 2160p** (4K natif), **Kling 3.0 Pro** et
    **Veo 3.1** (1080p, montés automatiquement en 4K par l'upscaler **Topaz**), ou Agnès Vidéo.
- **Film** — l'assistant en 7 étapes de l'application d'origine : genre et format, synopsis (10 propositions de l'IA
  à fusionner), personnages (IA ou vos photos), scénario et dialogues, découpage en plans, production vidéo, puis
  **montage 4K sur le téléphone** : tous les plans sont assemblés en un seul MP4 3840×2160 (H.265 ou H.264, 40 à 80 Mb/s),
  agrandis par un filtre bicubique avec renforcement de netteté adaptatif, puis enregistrés dans `Films/CineGenesis`.
- **Galerie** — toutes les créations et films exportés ; enregistrement dans la galerie du téléphone, partage,
  upscale 4K, « Animer » une image, réutiliser un prompt, export 4K local d'une vidéo.
- Tout est sauvegardé sur l'appareil (projets, galerie, générations en cours qui reprennent au redémarrage).

### Clés d'API

L'application n'embarque aucune clé : ajoutez les vôtres dans **Réglages** (elles restent sur le téléphone).

| Fournisseur | Utilisation | Où l'obtenir |
| --- | --- | --- |
| **fal.ai** (recommandé) | Images et vidéos 4K (Seedream, Nano Banana Pro, Kling 3.0, LTX-2.3, Veo 3.1, Topaz) et IA texte | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) |
| **Agnès** | Clés de l'application d'origine (texte, images 2K, vidéos 720p) | votre compte Agnès |
| Compatible OpenAI | IA texte au choix : DeepSeek, OpenAI, OpenRouter… | le site du fournisseur |

Les modèles fal.ai sont payants à l'usage (à titre indicatif : Kling 3.0 4K ≈ 0,42 $/s, LTX-2.3 en 2160p ≈ 0,24 $/s,
Seedream 4.5 ≈ 0,04 $/image) ; l'application affiche une estimation avant chaque génération et avant la production d'un film.

### Qualité 4K : comment c'est garanti

1. **4K natif** quand le modèle le permet (Kling 3.0 4K, LTX-2.3 2160p, Seedream 4.5 en 3840×2160 / 4096×4096).
2. Sinon, **upscale IA Topaz** sur fal.ai (option « Upscale automatique en 4K », activée par défaut).
3. Enfin, le **montage local** produit toujours un fichier 3840×2160 (ou 2160×3840 en portrait), quelle que soit la
   source. Si le téléphone ne sait pas encoder la 4K, l'application l'indique et exporte dans la meilleure définition possible.

### Architecture

```
film/src/main/
├── java/com/idrissta/cinegenesis/
│   ├── MainActivity.java   coque native : WebView plein écran, pont JS (réseau sans CORS, galerie, partage, voix…)
│   ├── FilmExporter.java   montage 4K avec Media3 Transformer (téléchargement des plans, encodage HEVC/H.264)
│   └── UpscaleEffect.java  shader OpenGL : agrandissement bicubique Catmull-Rom + netteté adaptative
└── assets/web/
    ├── index.html, css/app.css   interface
    ├── js/core.js       utilitaires, pont natif, stockage IndexedDB, réglages
    ├── js/engines.js    moteurs IA : Agnès (multi-clés), fal.ai (file d'attente), OpenAI-compatible, catalogue de modèles
    ├── js/film.js       assistant de film en 7 étapes et montage 4K
    ├── js/studio.js     studio de création rapide, galerie et visionneuse
    └── js/app.js        navigation, réglages, initialisation
```

Développer l'interface dans un navigateur : `python3 -m http.server 8000 -d film/src/main/assets/web`
(sans le pont natif, l'export 4K et l'enregistrement dans la galerie sont désactivés).
Tests : `node tools/test-film.js`.

---

# Nova Graph — calculatrice graphique pour Android

Calculatrice graphique moderne et hors ligne pour Android : tracé de courbes en temps réel, curseurs animables, calculatrice scientifique et table de valeurs, dans une interface sombre façon « verre dépoli ».

<p align="center">
  <img src="docs/graphe.png" width="220" alt="Graphe avec suivi de courbe">
  <img src="docs/clavier.png" width="220" alt="Clavier mathématique">
  <img src="docs/calcul.png" width="220" alt="Calculatrice scientifique">
  <img src="docs/exemples.png" width="220" alt="Galerie d'exemples (thème clair)">
</p>

## Fonctionnalités

**Graphe**
- Fonctions `y = f(x)`, `x = f(y)`, courbes implicites (`x² + y² = 9`), polaires (`r = 2cos(3θ)`), paramétrées (`(cos t, sin t)`) et points.
- Inéquations avec zones colorées (`y < sin(x)`, `x² + y² ≤ 4`) ; frontière en pointillés pour les inégalités strictes.
- Fonctions nommées réutilisables (`f(x) = …`, puis `f(2)`, `f′(x)`, `f″(x)`).
- Curseurs : `a = 2` crée un curseur réglable et animable ; une variable inconnue propose « ＋ Curseur ».
- Zoom à deux doigts, déplacement avec inertie, double appui pour zoomer.
- Suivi de courbe au doigt avec coordonnées et aimantation sur les points remarquables (racines, extremums, intersections, ordonnée à l'origine).
- Asymptotes et discontinuités gérées (tan, 1/x, partie entière…).
- Partage du graphe en image (enregistré dans la galerie).

**Calcul**
- Calculatrice scientifique avec aperçu du résultat en direct, historique, `Ans`, fractions et multiples de π (`0.75 → 3/4`, `1.5708 → π/2`).
- Trigonométrie en radians ou degrés, fonctions inverses (touche INV), factorielle, pourcentages.
- Intégrales `∫(x², 0, 3)`, sommes `Σ(k², k, 1, 10)`, produits, dérivées `d/dx(x³)`.
- Accès aux variables et fonctions définies dans l'onglet Graphe.

**Table** de valeurs pour toutes les fonctions visibles (début et pas réglables).

**Interface** : clavier mathématique intégré (pages 123 / f(x) / ABC en AZERTY), thèmes sombre, clair ou automatique, retours haptiques, bouton retour Android, sauvegarde automatique, affichage mathématique (fractions, exposants, racines).

## Installer l'APK

Voir [Télécharger les APK](#télécharger-les-apk) plus haut. Configuration requise : Android 8.0 (API 26) ou plus récent.

### Signature

Par défaut, les deux APK (Nova Graph et CINÉ-GENESIS) sont signés avec la clé de développement versionnée `app/nova-dev.keystore` (mot de passe public `android`) pour que chaque nouvelle version s'installe par-dessus la précédente. Pour une diffusion publique (Play Store…), utilisez votre propre clé en ajoutant ces secrets au dépôt :

| Secret | Contenu |
| --- | --- |
| `NOVA_KEYSTORE_BASE64` | le keystore encodé en base64 (`base64 -w0 ma-cle.jks`) |
| `NOVA_KEYSTORE_PASSWORD` | mot de passe du keystore |
| `NOVA_KEY_ALIAS` | alias de la clé |
| `NOVA_KEY_PASSWORD` | mot de passe de la clé |

## Compiler localement

Prérequis : JDK 17 et le SDK Android (Android Studio les fournit).

```bash
./gradlew assembleRelease      # → app/…/app-release.apk et film/…/film-release.apk
./gradlew :app:installDebug    # installe Nova Graph sur un appareil connecté
./gradlew :film:installDebug   # installe CINÉ-GENESIS
./gradlew :trouve:installDebug # installe Trouve ton IA
```

Ou ouvrez simplement le dossier dans Android Studio.

## Architecture

```
app/src/main/
├── java/com/idrissta/novagraph/MainActivity.java   coque native (WebView plein écran, pont JS)
├── assets/web/                                     application
│   ├── index.html, css/app.css                     interface
│   ├── js/math.js        analyse, compilation et calcul numérique (Gauss–Kronrod, dérivées, gamma…)
│   ├── js/workspace.js   expressions, définitions, curseurs, classification des tracés
│   ├── js/graph.js       rendu canvas, gestes, points remarquables
│   ├── js/keypad.js      clavier mathématique
│   └── js/app.js         onglets, calculatrice, table, réglages, persistance
└── res/                                            thème, icône adaptative (thème monochrome inclus)
```

L'interface est servie depuis les assets via une origine locale `https://appassets.androidplatform.net` interceptée par l'application : aucune requête réseau n'est effectuée et tout fonctionne hors ligne. Les polices Inter et JetBrains Mono (licence SIL OFL) sont embarquées.

### Développer l'interface dans un navigateur

```bash
python3 -m http.server 8000 -d app/src/main/assets/web
# puis ouvrir http://localhost:8000 en mode « appareil mobile »
```

### Tests

```bash
node tools/test-math.js   # tests du moteur mathématique (aussi lancés par la CI)
```
