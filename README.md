# IA Vidéo — applications Android

Ce dépôt contient quatre applications Android compilées automatiquement par GitHub Actions :

| Application | Dossier | Description |
| --- | --- | --- |
| **PronoFoot** | `prono/` | Pronostics de football : forme des équipes, confrontations directes et cotes de référence, 49 marchés de paris (1X2, buts, handicaps, mi-temps, score exact…). |
| **Vélo Champion** | `velo/` | Jeu de course cycliste en 3D : 5 niveaux de 10 étapes contre 10 adversaires, vélos plus rapides à acheter. |
| **CINÉ-GENESIS** | `film/` | Studio de création IA : images 4K, vidéos 4K (Kling 3.0, LTX-2.3, Veo 3.1…) et films complets montés en 4K sur le téléphone. |
| **Nova Graph** | `app/` | Calculatrice graphique hors ligne. |

## Télécharger les APK

À chaque push, le workflow **APK Android** compile, signe et publie les deux APK dans la version
[**apk-latest**](../../releases/tag/apk-latest) (lien fixe, toujours à jour) :

- `CineGenesis.apk` — `https://github.com/Idrissta/ia-video/releases/download/apk-latest/CineGenesis.apk`
- `NovaGraph.apk` — `https://github.com/Idrissta/ia-video/releases/download/apk-latest/NovaGraph.apk`

Ouvrez le lien depuis le téléphone, puis le fichier `.apk`, et autorisez l'installation depuis cette source si Android le demande
(Android 8.0 ou plus récent). Les APK sont aussi disponibles comme artefacts de chaque exécution (onglet **Actions**),
et un tag `v*` crée une *Release* versionnée.

---

# PronoFoot — pronostics de football

Analyse des matchs du jour (toutes compétitions couvertes par ESPN : grands championnats européens, compétitions
africaines, Amérique, Asie…) et calcul de la probabilité de chaque pari.

### Télécharger

Le workflow **APK PronoFoot** publie à chaque push la version [**prono-latest**](../../releases/tag/prono-latest) :

- `PronoFoot.apk` — `https://github.com/Idrissta/ia-video/releases/download/prono-latest/PronoFoot.apk`

Android 8.0 ou plus récent, connexion Internet requise (aucune clé ni compte à créer).

### Ce que fait l'application

- **Matchs** : liste des matchs d'une journée (d'avant-hier à J+6), regroupés par compétition, avec recherche,
  filtre « grands championnats » / « tous » / « à venir », score en direct et cotes 1X2 de référence.
- **Pronostic** : pour chaque match, le pari le plus sûr (ex. « Plus de 1,5 but », « Les deux équipes marquent »),
  5 autres pronostics classés, les paris *value*, la probabilité 1X2, les buts attendus et un indice de confiance.
- **Paris** : **49 marchés et plus de 300 paris** inspirés de 1xBet — 1X2, double chance, remboursé si nul,
  les deux équipes marquent, totaux (0,5 à 6,5), totaux asiatiques, totaux par équipe, nombre exact de buts,
  pair/impair, handicaps européens et asiatiques (lignes .25/.75 comprises), écart, résultat + total,
  double chance + total, gagne à zéro, score exact, 1re et 2e mi-temps, mi-temps/fin de match, mi-temps la plus
  prolifique, premier but, moment du premier but… Pour chaque pari : probabilité et **cote juste**.
- **Cotes 1xBet** : saisir la cote proposée par votre bookmaker à côté d'un pari affiche aussitôt sa
  **value** (espérance de gain) ; les paris où la cote est supérieure à la cote juste sont mis en avant.
- **Forme** et **Face-à-face** : les 5 derniers matchs de chaque équipe et leurs 5 dernières confrontations.
- **Suivis** : historique des pronostics suivis, vérifiés automatiquement après le match (taux de réussite).
- **Analyse manuelle** : pour un match absent de la liste, saisir les 5 derniers résultats de chaque équipe,
  les 5 confrontations et, si possible, les cotes 1X2.

### La méthode

1. **Données** (API publique ESPN) : 5 derniers matchs de chaque équipe, 5 dernières confrontations directes,
   classement et cotes de référence, complétés par jusqu'à **20 matchs récents** par équipe.
2. **Force des équipes** : attaque et défense de chaque équipe, à domicile et à l'extérieur, avec des matchs
   récents plus importants que les anciens et un retour vers la moyenne quand il y a peu de matchs.
3. **Confrontations directes** : petit ajustement selon les 5 derniers face-à-face (les plus récents comptent plus).
4. **Buts attendus → scores** : loi de Poisson corrigée (Dixon-Coles) pour chaque score, puis chaque pari est
   calculé à partir de ces probabilités ; mi-temps : deux périodes modélisées séparément.
5. **Cotes de référence** : la marge du bookmaker est retirée, puis le marché est combiné au modèle
   (réglage *Combiner avec les cotes de référence*).

Le modèle a été réglé puis **testé sur 7 943 matchs réels jamais vus** (12 championnats, données
[football-data.co.uk](https://www.football-data.co.uk)) : `node tools/prono-backtest.js`.

| Mesure | Résultat |
| --- | --- |
| Pronostic principal gagnant | 78 % |
| Bon résultat 1X2 — moyennes du championnat seules | 43 % |
| Bon résultat 1X2 — 5 derniers matchs + face-à-face | 49 % |
| Bon résultat 1X2 — 20 derniers matchs + face-à-face | 51 % |
| Bon résultat 1X2 — avec les cotes de référence | 53 % |
| Calibration : paris annoncés à 83 % | réalisés à 83 % |

Aucune méthode ne gagne à tous les coups : un pari annoncé à 80 % perd en moyenne une fois sur cinq.
Les paris sportifs sont réservés aux plus de 18 ans ; ne misez que ce que vous pouvez vous permettre de perdre.

### Architecture

```
prono/src/main/
├── java/com/idrissta/prono/MainActivity.java   coque native : WebView, relais réseau vers l'API ESPN, partage, retour
└── assets/web/
    ├── index.html, css/app.css   interface (thème sombre)
    ├── js/engine.js    modèle : forces des équipes, Dixon-Coles, marge des cotes, 49 marchés, value, règlement
    ├── js/data.js      données ESPN : matchs du jour, résumé d'un match, historiques, résultats
    ├── js/leagues.js   noms français et ordre des compétitions
    └── js/ui.js        écrans, saisie des cotes, suivis, analyse manuelle, réglages
```

Tests hors ligne (calculs, règlement de tous les paris, lecture des données) : `node tools/test-prono.js`.
Essai sur les vrais matchs à venir : `node tools/prono-e2e.js`.

---

# Vélo Champion — jeu de course cycliste

Course de vélo en 3D (vue derrière le coureur) en mode paysage, entièrement hors ligne.

### Télécharger

Le workflow **APK Vélo Champion** publie à chaque push la version [**velo-latest**](../../releases/tag/velo-latest) :

- `VeloChampion-TEST.apk` — **version de test** : les vélos payants se débloquent gratuitement (achat simulé)
  pour essayer les 5 niveaux. S'installe à côté de la vraie version (« Vélo Champion TEST »).
  `https://github.com/Idrissta/ia-video/releases/download/velo-latest/VeloChampion-TEST.apk`
- `VeloChampion.apk` — **version de production** : vélos payants via Google Play Billing.
  `https://github.com/Idrissta/ia-video/releases/download/velo-latest/VeloChampion.apk`

### Le jeu

- **5 niveaux × 10 étapes**. Chaque étape oppose le joueur à **10 adversaires du même niveau** :
  étape 1 = 10 faibles, étape 2 = 10 moyens, puis bons, confirmés, forts, très forts, experts, élites, maîtres
  et enfin 10 champions à l'étape 10.
- Il faut **finir 1er** pour débloquer l'étape suivante. Gagner l'étape 10 ouvre le niveau suivant.
- Chaque niveau est plus rapide et **demande un nouveau vélo** (payant) pour augmenter la vitesse :

  | Niveau | Décor | Vélo requis | Vitesse / sprint | Prix indicatif | Produit Google Play |
  | --- | --- | --- | --- | --- | --- |
  | 1 | Vallée Verte (campagne) | Rouleur Acier | 34 / 44 km/h | offert | — |
  | 2 | Côte d'Azur (couchant) | Alu Sprint | 40 / 52 km/h | 0,99 € | `velo_alu_sprint` |
  | 3 | Canyon Rouge (désert) | Carbone Pro | 47 / 61 km/h | 1,99 € | `velo_carbone_pro` |
  | 4 | Grand Col (montagne) | Aéro Chrono | 55 / 71,5 km/h | 2,99 € | `velo_aero_chrono` |
  | 5 | Néon City (nuit) | Fusion X | 64 / 83 km/h | 4,99 € | `velo_fusion_x` |

- **Commandes** : flèches ◀ ▶ (ou inclinaison du téléphone, au choix dans Réglages) pour se diriger, bouton
  **SPRINT** à maintenir (vide la jauge d'énergie). Rouler juste derrière un adversaire donne
  l'**aspiration** (plus de vitesse et recharge de l'énergie) ; les chocs, l'herbe et les montées ralentissent.
- Graphismes : route 3D avec virages et côtes, 5 décors complets (arbres, palmiers, cactus, chalets, ville néon,
  public, arches DÉPART/ARRIVÉE), coureurs animés vus de dos, confettis, résolution adaptée au téléphone.
- Sons et musique synthétisés, vibrations, sauvegarde automatique de la progression et des records.

### Activer les paiements (Google Play)

Les achats réels ne fonctionnent que pour une application **publiée sur Google Play** (au moins en test interne) :

1. Créer l'application `com.idrissta.velochampion` dans la [Play Console](https://play.google.com/console) et
   y envoyer l'APK ou l'AAB de production signé avec **votre propre clé** (voir *Signature* plus bas).
2. *Monétiser → Produits → Produits intégrés* : créer les 4 produits à achat unique du tableau ci-dessus
   (`velo_alu_sprint`, `velo_carbone_pro`, `velo_aero_chrono`, `velo_fusion_x`) et fixer leurs prix.
3. Ajouter vos comptes de test dans *Test de licence* pour acheter sans être débité.

Le jeu affiche alors le prix localisé renvoyé par Google Play, confirme chaque achat (sinon Google le rembourse
sous 3 jours) et restaure les vélos achetés après une réinstallation (*Réglages → Restaurer mes achats*).
Sans Google Play (APK installé à la main), la version de production indique que l'achat est indisponible.

### Architecture

```
velo/src/main/
├── java/com/idrissta/velochampion/
│   ├── MainActivity.java   coque native : WebView plein écran paysage, vibrations, retour, écran allumé
│   └── Billing.java        Google Play Billing (prix, achat, confirmation, restauration)
└── assets/web/
    ├── index.html, css/game.css   menus, HUD et commandes tactiles
    ├── js/data.js      vélos, niveaux, décors, adversaires
    ├── js/sim.js       tracé des étapes, physique, aspiration, adversaires (IA)
    ├── js/render.js    moteur de rendu pseudo-3D (Canvas 2D)
    ├── js/sprites.js   décors, arrière-plans, coureurs et vélos dessinés par le code
    ├── js/audio.js     effets sonores et musique (Web Audio)
    ├── js/save.js      progression et réglages
    ├── js/store.js     boutique (Google Play, ou achats simulés en version de test)
    └── js/ui.js        écrans, boucle de jeu, HUD
```

Jouer dans un navigateur (achats simulés) : `python3 -m http.server 8000 -d velo/src/main/assets/web`.
Tests (progression, tracés des 50 étapes, équilibrage par pilote automatique) : `node tools/test-velo.js`.

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

Par défaut, les APK (Nova Graph, CINÉ-GENESIS et Vélo Champion) sont signés avec la clé de développement versionnée `app/nova-dev.keystore` (mot de passe public `android`) pour que chaque nouvelle version s'installe par-dessus la précédente. Pour une diffusion publique (Play Store…), utilisez votre propre clé en ajoutant ces secrets au dépôt :

| Secret | Contenu |
| --- | --- |
| `NOVA_KEYSTORE_BASE64` | le keystore encodé en base64 (`base64 -w0 ma-cle.jks`) |
| `NOVA_KEYSTORE_PASSWORD` | mot de passe du keystore |
| `NOVA_KEY_ALIAS` | alias de la clé |
| `NOVA_KEY_PASSWORD` | mot de passe de la clé |

## Compiler localement

Prérequis : JDK 17 et le SDK Android (Android Studio les fournit).

```bash
./gradlew assembleRelease      # → app/…/app-release.apk, film/…/film-release.apk et velo/…/velo-release.apk
./gradlew :app:installDebug    # installe Nova Graph sur un appareil connecté
./gradlew :film:installDebug   # installe CINÉ-GENESIS
./gradlew :velo:installDebug   # installe Vélo Champion (version de test)
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
