/* Vélo Champion — simulation : tracé de l'étape, physique, adversaires. */
(function (root) {
  'use strict';
  const VC = root.VC;
  const SEG = VC.SEG;
  const ROAD = VC.ROAD;
  const U_M = VC.U_M;

  /* Réglages de la physique ------------------------------------------------ */
  const P = VC.PHYS = {
    riderW: 300,          // largeur de contact entre deux coureurs
    bikeLen: 950,         // longueur de contact (roue avant → roue arrière)
    draftLen: 7 * U_M,    // portée de l'aspiration
    draftW: 340,
    draftBonus: 0.085,    // gain de vitesse maximal dans l'aspiration
    gradeK: 1.25,         // influence de la pente sur la vitesse
    steer: 2700,          // vitesse latérale maximale (unités/s)
    centrifugal: 82,      // poussée vers l'extérieur des virages
    drain: 24,            // énergie consommée par seconde de sprint
    regen: 8.5,
    regenDraft: 9,
    tauDown: 2.4,
    offroad: 0.62,
    limit: ROAD * 1.55
  };

  /* Zones où placer chaque décor : [écart mini, écart maxi] en demi-largeurs. */
  const ZONES = {
    tree: [1.45, 5], tree2: [1.5, 5.5], bush: [1.3, 3.5], fence: [1.32, 1.36], house: [2.4, 5.5], hay: [1.8, 4],
    flowers: [1.25, 2.4], palm: [1.4, 4.2], villa: [2.3, 5], lamp: [1.22, 1.24], rock: [1.4, 4.5], cactus: [1.4, 5],
    cactus2: [1.5, 5], skull: [1.3, 2], sign: [1.35, 1.5], pine: [1.45, 5.5], pine2: [1.5, 6], chalet: [2.4, 5.5],
    snow: [1.4, 4], cow: [1.8, 3.6], building: [1.9, 3.2], building2: [2.2, 3.8], neon: [1.5, 1.7]
  };

  /* ======================================================================= */
  /* Tracé                                                                    */
  /* ======================================================================= */

  function Track(info) {
    const theme = VC.THEMES[info.theme];
    const rnd = VC.rng(info.seed);
    const segs = this.segments = [];
    this.theme = theme;
    this.themeId = info.theme;
    this.startZ = 45 * U_M;
    this.finishZ = this.startZ + info.distance * U_M;
    const endZ = this.finishZ + 230 * U_M;
    let y = 0;

    const add = (curve, ny) => {
      segs.push({ i: segs.length, curve, y1: y, y2: ny, props: [], mark: null });
      y = ny;
    };
    const road = (enter, hold, leave, curve, dy) => {
      const y0 = y;
      const total = enter + hold + leave;
      for (let n = 0; n < enter; n++) add(VC.easeIn(0, curve, n / enter), VC.easeInOut(y0, y0 + dy, n / total));
      for (let n = 0; n < hold; n++) add(curve, VC.easeInOut(y0, y0 + dy, (enter + n) / total));
      for (let n = 0; n < leave; n++) add(VC.easeInOut(curve, 0, n / leave), VC.easeInOut(y0, y0 + dy, (enter + hold + n) / total));
    };

    // Départ : ligne droite et plate.
    road(0, Math.ceil(this.startZ / SEG) + 45, 0, 0, 0);

    // Parcours aléatoire, propre à chaque étape.
    const finalStraight = Math.ceil(170 * U_M / SEG);
    const lastPieceEnd = Math.floor(this.finishZ / SEG) - finalStraight;
    let lastCurveSign = rnd() < 0.5 ? -1 : 1;
    while (segs.length < lastPieceEnd) {
      const room = lastPieceEnd - segs.length;
      const enter = Math.min(room, rnd.int(18, 45));
      const hold = Math.min(Math.max(0, room - enter), rnd.int(10, 90));
      const leave = Math.max(1, Math.min(room - enter - hold, rnd.int(18, 45)));
      let curve = 0;
      if (rnd() < 0.25 + theme.curvy * 0.6) {
        const strength = rnd.pick([5, 8, 11, 15, 19]) * VC.lerp(0.75, 1.15, theme.curvy);
        lastCurveSign = rnd() < 0.65 ? -lastCurveSign : lastCurveSign;
        curve = strength * lastCurveSign;
      }
      let dy = 0;
      if (rnd() < 0.2 + theme.hilly * 0.65) {
        const total = (enter + hold + leave) * SEG;
        const grade = rnd.range(0.03, 0.05 + 0.07 * theme.hilly);
        let sign = rnd() < 0.5 ? -1 : 1;
        if (y > 9000) sign = -1;
        if (y < -9000) sign = 1;
        dy = sign * grade * total;
      }
      road(enter, hold, leave, curve, dy);
    }
    // Dernière ligne droite plate pour le sprint, puis zone de décélération.
    const flatten = -y * 0.5;
    road(25, Math.max(10, Math.floor(this.finishZ / SEG) - segs.length - 25 + 20), 25, 0, flatten);
    while (segs.length * SEG < endZ) add(0, y);

    this.length = segs.length * SEG;
    this.placeProps(theme, rnd);
  }

  Track.prototype.segAt = function (z) {
    const i = Math.floor(z / SEG);
    return this.segments[i < 0 ? 0 : i >= this.segments.length ? this.segments.length - 1 : i];
  };

  Track.prototype.yAt = function (z) {
    const s = this.segAt(z);
    const t = VC.clamp((z - s.i * SEG) / SEG, 0, 1);
    return s.y1 + (s.y2 - s.y1) * t;
  };

  Track.prototype.gradeAt = function (z) {
    const s = this.segAt(z);
    return (s.y2 - s.y1) / SEG;
  };

  Track.prototype.placeProps = function (theme, rnd) {
    const segs = this.segments;
    const startI = Math.floor(this.startZ / SEG);
    const finishI = Math.floor(this.finishZ / SEG);
    let weightSum = 0;
    for (const p of theme.props) weightSum += p[1];
    const pickProp = () => {
      let r = rnd() * weightSum;
      for (const p of theme.props) {
        r -= p[1];
        if (r <= 0) return p[0];
      }
      return theme.props[0][0];
    };
    const put = (i, kind, x, extra) => {
      if (i < 0 || i >= segs.length) return;
      const prop = { kind, x, s: 1, flip: false };
      if (extra) Object.assign(prop, extra);
      segs[i].props.push(prop);
    };

    for (let i = 4; i < segs.length; i++) {
      const crowdZone = (i > startI - 12 && i < startI + 30) || (i > finishI - Math.ceil(240 * U_M / SEG) && i < finishI + 40);
      for (const side of [-1, 1]) {
        if (crowdZone) continue;
        if (rnd() > 0.42) continue;
        const kind = pickProp();
        const zone = ZONES[kind] || [1.4, 4];
        const off = VC.lerp(zone[0], zone[1], Math.pow(rnd(), 1.6));
        put(i, kind, side * off * ROAD, { s: VC.lerp(0.8, 1.25, rnd()), flip: rnd() < 0.5 });
      }
      // Panneaux de virage à l'extérieur des courbes serrées.
      const c = segs[i].curve;
      if (Math.abs(c) >= 13 && i % 9 === 0 && !crowdZone) put(i, c > 0 ? 'chevR' : 'chevL', (c > 0 ? -1 : 1) * ROAD * 1.3);
      // Public et barrières au départ et à l'arrivée.
      if (crowdZone) {
        put(i, 'barrier', -ROAD * 1.16);
        put(i, 'barrier', ROAD * 1.16, { flip: true });
        if (i % 2 === 0) {
          put(i, 'crowd', -ROAD * VC.lerp(1.3, 1.45, rnd()), { s: VC.lerp(0.9, 1.1, rnd()), seed: rnd.int(0, 5) });
          put(i, 'crowd', ROAD * VC.lerp(1.3, 1.45, rnd()), { s: VC.lerp(0.9, 1.1, rnd()), seed: rnd.int(0, 5), flip: true });
        }
        if (i % 14 === 0) {
          put(i, 'flag', -ROAD * 1.6, { seed: rnd.int(0, 5) });
          put(i, 'flag', ROAD * 1.6, { seed: rnd.int(0, 5) });
        }
      }
    }
    segs[startI].mark = 'start';
    segs[finishI].mark = 'finish';
    put(startI, 'archStart', 0);
    put(finishI, 'archFinish', 0);
    const dist = (this.finishZ - this.startZ) / U_M;
    const panels = [[1000, 'p1000'], [500, 'p500'], [200, 'p200']];
    for (const [m, kind] of panels) {
      if (dist < m + 150) continue;
      const i = Math.floor((this.finishZ - m * U_M) / SEG);
      put(i, kind, -ROAD * 1.4);
      put(i, kind, ROAD * 1.4, { flip: true });
    }
    for (let i = startI + 60; i < finishI - 200; i += 260) {
      if (rnd() < 0.7) put(i, 'billboard', (rnd() < 0.5 ? -1 : 1) * ROAD * 1.9);
    }
  };

  /* ======================================================================= */
  /* Coureurs                                                                 */
  /* ======================================================================= */

  function Rider(o) {
    this.id = o.id;
    this.name = o.name;
    this.num = o.num || 1;
    this.isPlayer = !!o.isPlayer;
    this.kit = o.kit;
    this.skin = o.skin || '#e8b48f';
    this.frame = o.frame || '#cfd8dc';
    this.wheel = o.wheel || 'spokes';
    this.x = o.x;
    this.z = o.z;
    this.speed = 0;
    this.cruise = VC.kmh(o.cruise);
    this.sprintSpeed = VC.kmh(o.sprint);
    this.tau = o.tau;
    this.handling = o.handling || 1;
    this.skill = o.skill === undefined ? 0.5 : o.skill;
    this.favorite = !!o.favorite;
    this.stamina = 100;
    this.sprinting = false;
    this.tired = false;
    this.draft = 0;
    this.offroad = false;
    this.crank = o.crank || 0;
    this.stand = 0;
    this.lean = 0;
    this.vx = 0;
    this.targetX = o.x;
    this.finished = false;
    this.finishTime = 0;
    this.started = this.isPlayer;
    this.react = o.react || 0;
    this.nextDrift = 2 + o.react * 3;
    this.attackAt = o.attackAt || 2;
    this.finalAt = o.finalAt || 0.9;
    this.cap = Infinity;
    this.wobble = o.wobblePhase || 0;
    this.rank = 0;
  }

  /* ======================================================================= */
  /* Course                                                                   */
  /* ======================================================================= */

  /**
   * cfg : { level, stage, bike, opponents?, demo? }
   */
  function Race(cfg) {
    const info = VC.stageInfo(cfg.level, cfg.stage);
    this.info = info;
    this.track = cfg.track || new Track(info);
    this.time = 0;
    this.countdown = cfg.demo ? 0 : 3.5;
    this.state = cfg.demo ? 'racing' : 'countdown';
    this.events = [];
    this.demo = !!cfg.demo;
    const rnd = VC.rng(info.seed ^ 0xbeef ^ (cfg.salt || 0));
    this.rnd = rnd;
    const startZ = this.track.startZ;
    const bike = cfg.bike;

    const riders = this.riders = [];
    this.player = new Rider({
      id: 0, name: cfg.playerName || 'Vous', num: 1, isPlayer: true, kit: VC.PLAYER_KIT, skin: cfg.playerSkin || '#e8b48f',
      frame: bike.frame, wheel: bike.wheel, x: 0, z: startZ - 2 * U_M,
      cruise: bike.cruise, sprint: bike.sprint, tau: bike.tau, handling: bike.handling
    });
    this.player.bike = bike;
    riders.push(this.player);

    // Grille de départ : les dix adversaires partent devant le joueur.
    const grid = [
      [7.5, -1350], [7.5, -450], [7.5, 450], [7.5, 1350],
      [4.6, -900], [4.6, 0], [4.6, 900],
      [1.8, -1350], [1.8, 1350], [1.8, -450]
    ];
    const opps = cfg.opponents || VC.makeOpponents(cfg.level, cfg.stage);
    const order = opps.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    opps.forEach((o, k) => {
      const g = grid[order[k] % grid.length];
      const skill = o.skill;
      riders.push(new Rider({
        id: k + 1, name: o.name, num: o.num, kit: o.kit, skin: o.skin, frame: o.kit[1] === '#ffffff' ? o.kit[0] : o.kit[1],
        wheel: skill > 0.65 ? 'deep' : 'spokes',
        x: g[1] + (rnd() - 0.5) * 120, z: startZ + g[0] * U_M - 2 * U_M,
        cruise: o.cruise, sprint: o.sprint, tau: o.tau, skill,
        favorite: o.favorite,
        react: 0.12 + (1 - skill) * rnd.range(0.15, 0.6),
        attackAt: skill >= 0.45 ? rnd.range(0.3, 0.7) : 2,
        finalAt: VC.lerp(0.9, 0.74, skill) + rnd.range(-0.03, 0.03),
        crank: rnd() * 6.28,
        wobblePhase: rnd() * 100
      }));
    });
    if (this.demo) {
      for (const r of riders) {
        r.started = true;
        r.speed = r.cruise * 0.9;
      }
    }
    this.updateRanks();
  }

  Race.prototype.progressOf = function (r) {
    return VC.clamp((r.z - this.track.startZ) / (this.track.finishZ - this.track.startZ), 0, 1);
  };

  Race.prototype.emit = function (type, data) {
    this.events.push({ type, data });
  };

  Race.prototype.update = function (dt, input) {
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after >= 1 && after <= 3) this.emit('count', after);
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.emit('go');
      }
      for (const r of this.riders) r.crank += dt * 0.6;
      return;
    }
    this.time += dt;
    const riders = this.riders;

    for (const r of riders) this.computeDraft(r);
    for (const r of riders) {
      if (r.isPlayer && !this.demo && !this.player.finished) this.controlPlayer(r, input || {}, dt);
      else if (r.isPlayer) this.controlAuto(r, dt);
      else this.controlAI(r, dt);
    }
    for (const r of riders) this.physics(r, dt);
    this.collide();
    this.checkFinish();
    this.updateRanks();
  };

  Race.prototype.computeDraft = function (r) {
    let best = 0;
    let leader = null;
    for (const o of this.riders) {
      if (o === r) continue;
      const dz = o.z - r.z;
      if (dz < P.bikeLen * 0.8 || dz > P.draftLen) continue;
      if (Math.abs(o.x - r.x) > P.draftW) continue;
      const d = 1 - (dz - P.bikeLen) / (P.draftLen - P.bikeLen);
      const v = VC.clamp(d, 0, 1) * (1 - Math.abs(o.x - r.x) / P.draftW * 0.5);
      if (v > best) {
        best = v;
        leader = o;
      }
    }
    r.draft = best;
    r.draftLeader = leader;
  };

  Race.prototype.controlPlayer = function (r, input, dt) {
    const sp = r.speed / r.sprintSpeed;
    const steer = VC.clamp(input.steer || 0, -1, 1);
    const target = steer * P.steer * r.handling * (0.3 + 0.7 * Math.min(1, sp * 1.25));
    r.vx = VC.approach(r.vx, target, 14, dt);
    r.x += r.vx * dt;
    const seg = this.track.segAt(r.z);
    r.x -= seg.curve * P.centrifugal * sp * sp * dt;
    const wantSprint = !!input.sprint && this.state === 'racing';
    if (wantSprint && !r.tired && r.stamina > 0) {
      if (!r.sprinting) this.emit('sprint');
      r.sprinting = true;
    } else {
      r.sprinting = false;
    }
  };

  /** Pilote automatique : utilisé après l'arrivée, pour la démo et pour les tests. */
  Race.prototype.controlAuto = function (r, dt) {
    const input = VC.autopilot(this, r);
    if (this.player.finished && r.isPlayer) input.sprint = false;
    this.controlPlayer(r, input, dt);
  };

  Race.prototype.isFree = function (self, x, back, ahead) {
    if (Math.abs(x) > ROAD - 260) return false;
    for (const o of this.riders) {
      if (o === self) continue;
      const dz = o.z - self.z;
      if (dz < -back || dz > ahead) continue;
      if (Math.abs(o.x - x) < P.riderW * 1.25) return false;
    }
    return true;
  };

  Race.prototype.controlAI = function (r, dt) {
    if (!r.started) {
      if (this.time >= r.react) r.started = true;
      else return;
    }
    const prog = this.progressOf(r);
    const finished = r.finished;

    // Sprint : attaque en cours de course pour les meilleurs, sprint final pour tous.
    if (finished) {
      r.sprinting = false;
    } else if (r.sprinting) {
      if (r.tired || (prog < r.finalAt && r.stamina < 35)) r.sprinting = false;
    } else if (!r.tired) {
      if (prog >= r.finalAt && r.stamina > 15) r.sprinting = true;
      else if (prog >= r.attackAt && r.stamina > 92) {
        r.sprinting = true;
        r.attackAt = prog + this.rnd.range(0.12, 0.3);
      }
    }

    // Trajectoire : dépasser les coureurs plus lents ou se caler dans leur roue.
    const look = 5 * U_M + r.speed * 0.5;
    let blocker = null;
    let bdz = Infinity;
    for (const o of this.riders) {
      if (o === r) continue;
      const dz = o.z - r.z;
      if (dz <= 0 || dz > look) continue;
      if (Math.abs(o.x - r.x) > P.riderW * 1.15) continue;
      if (dz < bdz) {
        bdz = dz;
        blocker = o;
      }
    }
    r.cap = Infinity;
    if (blocker && blocker.speed < r.speed * 1.01) {
      const gap = P.riderW * 1.55;
      const sides = blocker.x > r.x ? [-1, 1] : [1, -1];
      let moved = false;
      if (this.rnd() < 0.25 + 0.75 * r.skill || bdz < 2.5 * U_M) {
        for (const s of sides) {
          const cx = blocker.x + s * gap;
          if (this.isFree(r, cx, P.bikeLen * 1.6, look)) {
            r.targetX = cx;
            moved = true;
            break;
          }
        }
      }
      if (!moved && bdz < 3.2 * U_M) r.cap = blocker.speed * (bdz < 1.6 * U_M ? 0.97 : 1.0);
    } else if (this.time > r.nextDrift) {
      r.nextDrift = this.time + this.rnd.range(1.5, 5);
      const cx = VC.clamp(r.x + this.rnd.range(-700, 700), -ROAD + 350, ROAD - 350);
      if (this.isFree(r, cx, P.bikeLen * 1.5, look)) r.targetX = cx;
    }
    r.targetX = VC.clamp(r.targetX, -ROAD + 300, ROAD - 300);
    const wob = (1 - r.skill) * 160 * Math.sin(this.time * 0.9 + r.wobble);
    const maxV = 900 + 1300 * r.skill;
    const want = VC.clamp((r.targetX + wob - r.x) * 3, -maxV, maxV);
    r.vx = VC.approach(r.vx, want, 8, dt);
    r.x += r.vx * dt;
  };

  Race.prototype.physics = function (r, dt) {
    const track = this.track;
    r.x = VC.clamp(r.x, -P.limit, P.limit);
    r.offroad = Math.abs(r.x) > ROAD;
    let target = 0;
    if (r.started) {
      const grade = track.gradeAt(r.z);
      let f = VC.clamp(1 - grade * P.gradeK, 0.66, 1.3);
      if (r.offroad) f *= P.offroad;
      f *= 1 + r.draft * P.draftBonus;
      target = (r.sprinting ? r.sprintSpeed : r.cruise) * f;
      if (!r.isPlayer) {
        // Les meilleurs adversaires ne lâchent rien quand le joueur s'échappe.
        const behind = (this.player.z - r.z) / U_M;
        if (behind > 25 && !r.finished) target *= 1 + Math.min(0.05, (behind - 25) / 400) * r.skill;
        if (r.cap < target) target = r.cap;
      }
      if (r.finished) target = r.cruise * 0.45;
    }
    const tau = r.speed < target ? r.tau : P.tauDown;
    r.speed += (target - r.speed) * (1 - Math.exp(-dt / tau));
    if (r.speed < 0) r.speed = 0;
    r.z += r.speed * dt;
    if (r.z > track.length - 30 * U_M) {
      r.z = track.length - 30 * U_M;
      r.speed = 0;
    }

    if (r.sprinting) {
      r.stamina -= P.drain * dt;
      if (r.stamina <= 0) {
        r.stamina = 0;
        r.sprinting = false;
        r.tired = true;
        if (r.isPlayer) this.emit('tired');
      }
    } else {
      r.stamina = Math.min(100, r.stamina + (P.regen + r.draft * P.regenDraft) * dt);
      if (r.tired && r.stamina >= 30) r.tired = false;
    }

    const cadence = r.speed > 10 ? 2.2 + 8.5 * r.speed / r.sprintSpeed : 0;
    r.crank += dt * cadence * (r.sprinting ? 1.1 : 1);
    r.stand = VC.approach(r.stand, r.sprinting ? 1 : 0, 6, dt);
    r.lean = VC.approach(r.lean, VC.clamp(r.vx / 3200, -0.3, 0.3), 6, dt);
  };

  Race.prototype.collide = function () {
    const rs = this.riders;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        let a = rs[i];
        let b = rs[j];
        let dz = b.z - a.z;
        if (Math.abs(dz) >= P.bikeLen) continue;
        const dx = b.x - a.x;
        if (Math.abs(dx) >= P.riderW) continue;
        if (dz < 0) {
          const t = a;
          a = b;
          b = t;
          dz = -dz;
        }
        // a est derrière b.
        if (dz > P.bikeLen * 0.5) {
          a.z = b.z - P.bikeLen;
          if (a.speed > b.speed * 0.92) a.speed = b.speed * 0.92;
          const push = (dx >= 0 ? -1 : 1) * 60;
          a.x += push;
          if (a.isPlayer) this.emit('bump', { hard: true, other: b });
          else if (b.isPlayer) this.emit('bump', { hard: false, other: a });
        } else {
          const overlap = (P.riderW - Math.abs(dx)) / 2 + 1;
          const s = dx >= 0 ? 1 : -1;
          rs[i].x -= s * overlap;
          rs[j].x += s * overlap;
          a.speed *= 0.995;
          b.speed *= 0.995;
          if (a.isPlayer || b.isPlayer) this.emit('rub', { other: a.isPlayer ? b : a });
        }
      }
    }
  };

  Race.prototype.checkFinish = function () {
    const fz = this.track.finishZ;
    for (const r of this.riders) {
      if (r.finished || r.z < fz) continue;
      r.finished = true;
      const over = (r.z - fz) / Math.max(1, r.speed);
      r.finishTime = this.time - over;
      if (r.isPlayer) {
        this.state = 'finished';
        this.finishAt = this.time;
        this.results = this.computeResults();
        this.emit('finish', this.results);
      }
    }
  };

  /** Classement final : temps réels pour les arrivés, estimation pour les autres. */
  Race.prototype.computeResults = function () {
    const fz = this.track.finishZ;
    const list = this.riders.map((r) => {
      let t = r.finishTime;
      if (!r.finished) t = this.time + (fz - r.z) / Math.max(r.speed, r.cruise * 0.8);
      return { rider: r, time: t, name: r.name, isPlayer: r.isPlayer, kit: r.kit, num: r.num };
    });
    list.sort((p, q) => p.time - q.time);
    const best = list[0].time;
    list.forEach((e, i) => {
      e.pos = i + 1;
      e.gap = e.time - best;
    });
    const me = list.find((e) => e.isPlayer);
    return { list, position: me.pos, time: me.time, won: me.pos === 1 };
  };

  Race.prototype.updateRanks = function () {
    const sorted = this.riders.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.z - a.z;
    });
    const before = this.player.rank;
    sorted.forEach((r, i) => {
      r.rank = i + 1;
    });
    this.sorted = sorted;
    if (before && this.player.rank !== before && this.state === 'racing') {
      this.emit(this.player.rank < before ? 'gain' : 'lose', this.player.rank);
    }
  };

  /* ======================================================================= */
  /* Pilote automatique (démo, tests d'équilibrage, après l'arrivée)          */
  /* ======================================================================= */

  VC.autopilot = function (race, r) {
    const seg = race.track.segAt(r.z);
    const sp = r.speed / r.sprintSpeed;
    const look = 11 * U_M;
    let blocker = null;
    let bdz = Infinity;
    for (const o of race.riders) {
      if (o === r) continue;
      const dz = o.z - r.z;
      if (dz <= -P.bikeLen * 0.6 || dz > look) continue;
      if (Math.abs(o.x - r.x) > P.riderW * 1.35) continue;
      if (dz < bdz) {
        bdz = dz;
        blocker = o;
      }
    }
    if (r.apX === undefined) r.apX = r.x;
    if (blocker && blocker.speed < r.speed * 1.03) {
      if (Math.abs(r.apX - r.x) < 150 || !race.isFree(r, r.apX, P.bikeLen * 1.2, look)) {
        let best = null;
        let bestD = Infinity;
        for (let cx = -ROAD + 300; cx <= ROAD - 300; cx += 150) {
          if (!race.isFree(r, cx, P.bikeLen * 1.2, look)) continue;
          const d = Math.abs(cx - r.x);
          if (d < bestD) {
            bestD = d;
            best = cx;
          }
        }
        if (best !== null) r.apX = best;
      }
    } else if (r.draftLeader && r.draftLeader.speed > r.cruise * 0.97 && !r.sprinting) {
      r.apX = r.draftLeader.x;
    }
    const sideways = (r.apX - r.x) / 500;
    const counter = seg.curve * P.centrifugal * sp * sp / (P.steer * r.handling);
    const steer = VC.clamp(sideways + counter, -1, 1);
    const prog = race.progressOf(r);
    let sprint;
    if (prog > 0.8) sprint = !r.tired;
    else sprint = r.sprinting ? r.stamina > 40 : (r.stamina > 97 && (!blocker || bdz > 6 * U_M));
    return { steer, sprint };
  };

  VC.Track = Track;
  VC.Race = Race;
  VC.Rider = Rider;
})(typeof window !== 'undefined' ? window : globalThis);
