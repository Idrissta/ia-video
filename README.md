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

Chaque push déclenche le workflow **APK Android** (`.github/workflows/android.yml`) qui compile un APK signé :

1. Onglet **Actions** du dépôt → dernière exécution réussie → artefact **NovaGraph-apk** (fichier zip contenant l'APK).
2. Pour une version téléchargeable directement, poussez un tag : `git tag v1.0.0 && git push origin v1.0.0`. L'APK est alors joint à une *Release* GitHub.
3. Sur le téléphone, ouvrez le fichier `.apk` et autorisez l'installation depuis cette source si Android le demande.

Configuration requise : Android 8.0 (API 26) ou plus récent.

### Signature

Par défaut, l'APK est signé avec la clé de développement versionnée `app/nova-dev.keystore` (mot de passe public `android`) pour que chaque nouvelle version s'installe par-dessus la précédente. Pour une diffusion publique (Play Store…), utilisez votre propre clé en ajoutant ces secrets au dépôt :

| Secret | Contenu |
| --- | --- |
| `NOVA_KEYSTORE_BASE64` | le keystore encodé en base64 (`base64 -w0 ma-cle.jks`) |
| `NOVA_KEYSTORE_PASSWORD` | mot de passe du keystore |
| `NOVA_KEY_ALIAS` | alias de la clé |
| `NOVA_KEY_PASSWORD` | mot de passe de la clé |

## Compiler localement

Prérequis : JDK 17 et le SDK Android (Android Studio les fournit).

```bash
./gradlew assembleRelease      # → app/build/outputs/apk/release/app-release.apk
./gradlew installDebug         # installe sur un appareil connecté
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
