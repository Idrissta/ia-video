/* Vélo Champion — données du jeu : vélos, niveaux, étapes, adversaires. */
(function (root) {
  'use strict';
  const VC = root.VC;

  /* Échelle du monde ---------------------------------------------------- */
  VC.SEG = 400;          // longueur d'un segment de route (unités)
  VC.ROAD = 2000;        // demi-largeur de la route (unités)
  VC.U_M = 750;          // unités par mètre parcouru
  VC.BODY = 5;           // unités par centimètre pour la taille des coureurs
  VC.kmh = (kmh) => kmh / 3.6 * VC.U_M;
  VC.toKmh = (u) => u / VC.U_M * 3.6;

  VC.STAGES_PER_LEVEL = 10;

  /* Vélos -----------------------------------------------------------------
   * Chaque niveau demande le vélo du même rang : le vélo 1 est offert, les
   * suivants s'achètent (Google Play). `product` est l'identifiant du produit
   * intégré à créer dans la Play Console ; `price` est le prix affiché tant
   * que Google Play n'a pas renvoyé le prix localisé.
   */
  VC.BIKES = [
    {
      id: 'rouleur', tier: 1, name: 'Rouleur Acier', tag: 'Le vélo de départ, solide et fiable.',
      cruise: 34, sprint: 44, tau: 1.9, handling: 1.0,
      frame: '#d7263d', accent: '#f5f5f5', wheel: 'spokes', product: null, price: 'Offert'
    },
    {
      id: 'alu', tier: 2, name: 'Alu Sprint', tag: 'Cadre aluminium léger : +18 % de vitesse.',
      cruise: 40, sprint: 52, tau: 1.75, handling: 1.05,
      frame: '#1e88e5', accent: '#ffffff', wheel: 'spokes', product: 'velo_alu_sprint', price: '0,99 €'
    },
    {
      id: 'carbone', tier: 3, name: 'Carbone Pro', tag: 'Carbone et jantes hautes, taillé pour la course.',
      cruise: 47, sprint: 61, tau: 1.6, handling: 1.1,
      frame: '#20232a', accent: '#ff5a1f', wheel: 'deep', product: 'velo_carbone_pro', price: '1,99 €'
    },
    {
      id: 'aero', tier: 4, name: 'Aéro Chrono', tag: 'Profil aérodynamique de contre-la-montre.',
      cruise: 55, sprint: 71.5, tau: 1.45, handling: 1.1,
      frame: '#10b981', accent: '#0b1f33', wheel: 'deep', product: 'velo_aero_chrono', price: '2,99 €'
    },
    {
      id: 'fusion', tier: 5, name: 'Fusion X', tag: 'Prototype ultime : roues lenticulaires, vitesse maximale.',
      cruise: 64, sprint: 83, tau: 1.3, handling: 1.18,
      frame: '#8b5cf6', accent: '#ffd21f', wheel: 'disc', product: 'velo_fusion_x', price: '4,99 €'
    }
  ];
  VC.bike = (id) => VC.BIKES.find((b) => b.id === id) || VC.BIKES[0];
  VC.bikeOfTier = (t) => VC.BIKES[VC.clamp(t, 1, VC.BIKES.length) - 1];

  /* Niveaux d'adversaires (une étape = dix adversaires du même niveau) ---- */
  VC.TIERS = [
    { name: 'Faibles', one: 'Faible', f: 0.80, skill: 0.10, color: '#7ddf64' },
    { name: 'Moyens', one: 'Moyen', f: 0.835, skill: 0.20, color: '#a3e05a' },
    { name: 'Bons', one: 'Bon', f: 0.865, skill: 0.30, color: '#d4e157' },
    { name: 'Confirmés', one: 'Confirmé', f: 0.89, skill: 0.40, color: '#ffd54f' },
    { name: 'Forts', one: 'Fort', f: 0.915, skill: 0.50, color: '#ffb74d' },
    { name: 'Très forts', one: 'Très fort', f: 0.93, skill: 0.60, color: '#ff8a50' },
    { name: 'Experts', one: 'Expert', f: 0.945, skill: 0.70, color: '#ff6e6e' },
    { name: 'Élites', one: 'Élite', f: 0.958, skill: 0.80, color: '#f06292' },
    { name: 'Maîtres', one: 'Maître', f: 0.97, skill: 0.90, color: '#ba68c8' },
    { name: 'Champions', one: 'Champion', f: 0.982, skill: 1.0, color: '#ffd21f' }
  ];

  /* Niveaux et décors ------------------------------------------------------ */
  VC.THEMES = {
    campagne: {
      sky: ['#2f7fdc', '#79b8f0', '#d7ecfb'], sun: { x: 0.72, y: 0.16, r: 0.05, color: '#fffbe6', glow: '#fff4c2' },
      clouds: { n: 9, color: '#ffffff', alpha: 0.9 },
      far: { kind: 'mountains', colors: ['#7d9fc6', '#9db9d8'], snow: false },
      near: { kind: 'hills', color: '#5aa040', color2: '#4b8d35' },
      grass: ['#62b33c', '#58a535'], shoulder: ['#cdb98c', '#c1ad80'], road: ['#6d7077', '#686b72'],
      rumble: ['#f2f2f2', '#d6313b'], lane: '#f7f7f7', fog: '#d4e9f8', fogDensity: 4.5,
      props: [['tree', 34], ['bush', 18], ['tree2', 16], ['fence', 10], ['house', 4], ['hay', 6], ['flowers', 12]],
      curvy: 0.5, hilly: 0.45
    },
    cote: {
      sky: ['#3346a3', '#e5806a', '#ffd9a0'], sun: { x: 0.3, y: 0.34, r: 0.075, color: '#fff1c9', glow: '#ffb36b' },
      clouds: { n: 6, color: '#ffd0b5', alpha: 0.75 },
      far: { kind: 'sea', colors: ['#7c6fa8', '#9a82b5'], sea: '#3f6fb8' },
      near: { kind: 'hills', color: '#7d8f4a', color2: '#6b7d3e' },
      grass: ['#a4b55d', '#98a954'], shoulder: ['#e6cf9b', '#dcc48f'], road: ['#606168', '#5b5c63'],
      rumble: ['#ffffff', '#1f6fd6'], lane: '#ffffff', fog: '#f5c9a0', fogDensity: 4,
      props: [['palm', 34], ['villa', 8], ['lamp', 12], ['bush', 16], ['rock', 8], ['flowers', 10]],
      curvy: 0.85, hilly: 0.5
    },
    canyon: {
      sky: ['#3d8fd6', '#8cc3ea', '#f4dcb0'], sun: { x: 0.55, y: 0.12, r: 0.05, color: '#ffffff', glow: '#fff0c8' },
      clouds: { n: 3, color: '#ffffff', alpha: 0.6 },
      far: { kind: 'mesa', colors: ['#b8603f', '#d48a5c'] },
      near: { kind: 'dunes', color: '#cf8a55', color2: '#c27c49' },
      grass: ['#dba56b', '#d29b61'], shoulder: ['#c98d57', '#bf834e'], road: ['#776a61', '#71645b'],
      rumble: ['#f5f5f5', '#e39a1d'], lane: '#fff3d6', fog: '#f3d8ae', fogDensity: 3.5,
      props: [['cactus', 30], ['rock', 30], ['cactus2', 14], ['skull', 3], ['sign', 4]],
      curvy: 0.35, hilly: 0.35
    },
    alpes: {
      sky: ['#245fb5', '#6aa6e6', '#e3f0fc'], sun: { x: 0.2, y: 0.12, r: 0.045, color: '#ffffff', glow: '#eaf4ff' },
      clouds: { n: 7, color: '#ffffff', alpha: 0.85 },
      far: { kind: 'mountains', colors: ['#5f7896', '#8aa2bd'], snow: true },
      near: { kind: 'forest', color: '#2f5f3c', color2: '#264f32' },
      grass: ['#4f914b', '#478743'], shoulder: ['#a3a39d', '#989892'], road: ['#5d6168', '#585c63'],
      rumble: ['#ffffff', '#e0353d'], lane: '#ffffff', fog: '#e5eff9', fogDensity: 4.5,
      props: [['pine', 44], ['pine2', 18], ['rock', 12], ['chalet', 5], ['snow', 8], ['cow', 3]],
      curvy: 0.7, hilly: 1.0
    },
    nuit: {
      sky: ['#04030d', '#1d0b3c', '#9b2370'], sun: { x: 0.78, y: 0.14, r: 0.035, color: '#f4f1ff', glow: '#a99cff', moon: true },
      clouds: { n: 0 }, stars: true,
      far: { kind: 'city', colors: ['#1a1036', '#24164a'] },
      near: { kind: 'city2', color: '#120b26', color2: '#0f0920' },
      grass: ['#191b29', '#161825'], shoulder: ['#2b2e40', '#26293a'], road: ['#26272f', '#222329'],
      rumble: ['#ff2bd6', '#22e4ff'], lane: '#fff36b', fog: '#2a0f45', fogDensity: 3.2, night: true,
      props: [['building', 40], ['lamp', 26], ['neon', 10], ['building2', 24]],
      curvy: 0.9, hilly: 0.2
    }
  };

  VC.LEVELS = [
    { n: 1, name: 'Vallée Verte', theme: 'campagne', place: 'Campagne', bike: 1 },
    { n: 2, name: 'Côte d’Azur', theme: 'cote', place: 'Littoral au couchant', bike: 2 },
    { n: 3, name: 'Canyon Rouge', theme: 'canyon', place: 'Désert', bike: 3 },
    { n: 4, name: 'Grand Col', theme: 'alpes', place: 'Haute montagne', bike: 4 },
    { n: 5, name: 'Néon City', theme: 'nuit', place: 'Métropole de nuit', bike: 5 }
  ];

  /* Étapes ------------------------------------------------------------------ */

  VC.stageDistance = function (level, stage) {
    return Math.round((500 + 50 * stage) * (1 + 0.18 * (level - 1)) / 10) * 10;
  };

  VC.stageSeed = (level, stage) => VC.hash('velo-champion/' + level + '/' + stage);

  const FIRST = ['Léo', 'Hugo', 'Nina', 'Jules', 'Emma', 'Lucas', 'Inès', 'Noah', 'Lina', 'Adam', 'Sarah', 'Yanis',
    'Chloé', 'Rayan', 'Manon', 'Mathis', 'Jade', 'Ethan', 'Léa', 'Malik', 'Aya', 'Tom', 'Zoé', 'Sacha', 'Camille',
    'Nathan', 'Lola', 'Enzo', 'Maëlle', 'Amine', 'Louise', 'Gabin', 'Yasmine', 'Théo', 'Clara', 'Ibrahim', 'Alice',
    'Diego', 'Fatou', 'Marco', 'Elena', 'Kofi', 'Mia', 'Lars', 'Sofia', 'Tadej', 'Remco', 'Jonas', 'Primož', 'Wout'];
  const LAST = ['Martin', 'Bernard', 'Diallo', 'Petit', 'Moreau', 'Laurent', 'Garcia', 'Roux', 'Fontaine', 'Mercier',
    'Traoré', 'Lambert', 'Rossi', 'Dupont', 'Girard', 'Bonnet', 'Chevalier', 'Blanc', 'Faure', 'André', 'Keita',
    'Lefèvre', 'Muller', 'Sanchez', 'Costa', 'Nguyen', 'Duval', 'Perrin', 'Ba', 'Rivière', 'Morel', 'Vidal',
    'Barbier', 'Camara', 'Leroy', 'Colin', 'Gauthier', 'Brun', 'Navarro', 'Silva', 'Pellegrini', 'Janssen'];

  /** Maillots : [principal, secondaire, cuissard, casque, motif]. */
  VC.KITS = [
    ['#e53935', '#ffffff', '#1a1a1a', '#e53935', 'band'],
    ['#1e88e5', '#0d47a1', '#0d1b2a', '#ffffff', 'sides'],
    ['#43a047', '#ffffff', '#1b2e1b', '#43a047', 'band'],
    ['#ffffff', '#e53935', '#1a1a1a', '#ffffff', 'dots'],
    ['#fb8c00', '#212121', '#212121', '#fb8c00', 'sides'],
    ['#8e24aa', '#f3e5f5', '#1a1a1a', '#8e24aa', 'band'],
    ['#00acc1', '#ffffff', '#062b33', '#ffffff', 'stripes'],
    ['#212121', '#ff4081', '#212121', '#ff4081', 'sides'],
    ['#ff7043', '#ffffff', '#3e2723', '#ffffff', 'band'],
    ['#3949ab', '#ffeb3b', '#1a237e', '#3949ab', 'stripes'],
    ['#c0ca33', '#1b5e20', '#1b1b1b', '#c0ca33', 'sides'],
    ['#6d4c41', '#ffcc80', '#1a1a1a', '#ffcc80', 'band'],
    ['#ec407a', '#ffffff', '#1a1a1a', '#ffffff', 'stripes'],
    ['#00897b', '#b2dfdb', '#0b2b27', '#00897b', 'band']
  ];
  VC.PLAYER_KIT = ['#ffd21f', '#1a1a1a', '#1a1a1a', '#ffffff', 'player'];
  const SKINS = ['#f1c7a5', '#e0ac85', '#c68a5f', '#a86b43', '#8a5232', '#5e3824', '#f5d3b8'];

  /** Les dix adversaires d'une étape (déterministes pour une étape donnée). */
  VC.makeOpponents = function (level, stage) {
    const rnd = VC.rng(VC.stageSeed(level, stage) ^ 0x5eed);
    const tier = VC.TIERS[stage - 1];
    const ref = VC.bikeOfTier(level).cruise;
    const used = new Set();
    const kits = VC.KITS.slice();
    for (let i = kits.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = kits[i];
      kits[i] = kits[j];
      kits[j] = t;
    }
    const list = [];
    for (let i = 0; i < 10; i++) {
      let name;
      do {
        name = rnd.pick(FIRST) + ' ' + rnd.pick(LAST);
      } while (used.has(name));
      used.add(name);
      // Le premier adversaire est un peu plus fort : il fait office de « favori ».
      const spread = i === 0 ? 0.018 : (rnd() - 0.5) * 0.045;
      const cruise = ref * tier.f * (1 + spread);
      list.push({
        name,
        num: 10 + ((level * 37 + stage * 11 + i * 7) % 89),
        kit: kits[i % kits.length],
        skin: rnd.pick(SKINS),
        cruise,
        sprint: cruise * (1.2 + 0.05 * tier.skill),
        tau: VC.lerp(2.3, 1.5, tier.skill) * VC.lerp(1.05, 0.95, rnd()),
        skill: VC.clamp(tier.skill + (rnd() - 0.5) * 0.15, 0.05, 1),
        favorite: i === 0
      });
    }
    return list;
  };

  /** Description complète d'une étape. */
  VC.stageInfo = function (level, stage) {
    const L = VC.LEVELS[level - 1];
    return {
      level, stage,
      levelName: L.name,
      theme: L.theme,
      tier: VC.TIERS[stage - 1],
      distance: VC.stageDistance(level, stage),
      seed: VC.stageSeed(level, stage),
      requiredBike: VC.bikeOfTier(L.bike)
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
