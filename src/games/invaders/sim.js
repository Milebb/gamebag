export const W = 100;
export const H = 160;
export const COLS = 8;
export const ROWS = 5;
export const CELL_W = 10;
export const CELL_H = 8;
export const ALIEN_W = 8;
export const ALIEN_H = 5.5;
export const SHIP_Y = H - 12;
export const SHIP_W = 9;
export const SHIP_H = 5;
export const COMMANDER_COOLDOWN = 0.9;
export const BULLET_SPEED = 150;
export const BOMB_SPEED = 48;

const FIRE_COOLDOWN = 0.45;
const MAX_BULLETS = 2;
const STEP_DOWN = 4;
const INVULNERABLE = 1.5;
const LIVES = 3;
const ROW_POINTS = [30, 20, 20, 10, 10];
const DIFFICULTY = {
  easy: { speed: 0.8, fire: 1.6 },
  medium: { speed: 1, fire: 1.1 },
  hard: { speed: 1.25, fire: 0.7 },
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const clampShip = (x) => clamp(x, SHIP_W / 2, W - SHIP_W / 2);

export function createGame({ ships = 1, difficulty = 'medium', versus = false }) {
  const game = {
    versus,
    difficulty: versus ? 'medium' : difficulty,
    wave: 1,
    score: 0,
    phase: 'countdown',
    timer: 2.5,
    winner: null,
    anim: 0,
    animTimer: 0,
    fireTimer: 1.5,
    commanderCooldown: 0,
    ships: Array.from({ length: ships }, (_, i) => ({
      x: (W * (i + 1)) / (ships + 1),
      lives: LIVES,
      inv: 0,
      cooldown: 0.3 * i,
      target: null,
    })),
  };
  spawnWave(game);
  return game;
}

function spawnWave(game) {
  game.alive = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
  game.fleet = { x: (W - COLS * CELL_W) / 2, y: 18 + Math.min(4, game.wave - 1) * 3, dir: 1 };
  game.bullets = [];
  game.bombs = [];
}

export const aliveCount = (game) => game.alive.reduce((n, row) => n + row.filter(Boolean).length, 0);

export function alienRect(game, row, col) {
  return {
    x: game.fleet.x + col * CELL_W + (CELL_W - ALIEN_W) / 2,
    y: game.fleet.y + row * CELL_H,
    w: ALIEN_W,
    h: ALIEN_H,
  };
}

export function fleetSpeed(game) {
  const total = ROWS * COLS;
  const base = 5 * (1 + 0.15 * (game.wave - 1)) * DIFFICULTY[game.difficulty].speed;
  return base * (1 + 3.5 * (1 - aliveCount(game) / total));
}

function fleetBounds(game) {
  let minCol = COLS;
  let maxCol = -1;
  let maxRow = -1;
  game.alive.forEach((row, r) =>
    row.forEach((alive, c) => {
      if (!alive) return;
      minCol = Math.min(minCol, c);
      maxCol = Math.max(maxCol, c);
      maxRow = Math.max(maxRow, r);
    }),
  );
  return { minCol, maxCol, maxRow };
}

function fireFromColumn(game, col) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (!game.alive[row][col]) continue;
    const rect = alienRect(game, row, col);
    game.bombs.push({ x: rect.x + rect.w / 2, y: rect.y + rect.h });
    return true;
  }
  return false;
}

function nearestColumn(game, x) {
  let best = null;
  let bestDistance = Infinity;
  for (let col = 0; col < COLS; col++) {
    if (!game.alive.some((row) => row[col])) continue;
    const distance = Math.abs(game.fleet.x + col * CELL_W + CELL_W / 2 - x);
    if (distance < bestDistance) {
      best = col;
      bestDistance = distance;
    }
  }
  return best;
}

/** Versus mode: the alien player fires from the column closest to x. */
export function commanderFire(game, x) {
  if (game.phase !== 'play' || game.commanderCooldown > 0) return false;
  const col = nearestColumn(game, x);
  if (col === null || !fireFromColumn(game, col)) return false;
  game.commanderCooldown = COMMANDER_COOLDOWN;
  return true;
}

function autoFire(game) {
  const living = game.ships.filter((ship) => ship.lives > 0);
  const aimAt = living.length && Math.random() < 0.5 ? living[Math.floor(Math.random() * living.length)].x : null;
  const columns = [...Array(COLS).keys()].filter((col) => game.alive.some((row) => row[col]));
  const col = aimAt !== null ? nearestColumn(game, aimAt) : columns[Math.floor(Math.random() * columns.length)];
  if (col !== null && col !== undefined) fireFromColumn(game, col);
}

/**
 * Advances the game by dt seconds (mutates it).
 * Returns events: { type: 'kill', row, col } | { type: 'shipHit', ship } | { type: 'march' } | { type: 'wave' } | { type: 'over' }
 */
export function step(game, dt) {
  const events = [];
  if (game.phase === 'over') return events;

  if (game.phase === 'countdown' || game.phase === 'wave') {
    game.timer -= dt;
    if (game.timer <= 0) game.phase = 'play';
    return events;
  }

  for (const [index, ship] of game.ships.entries()) {
    if (ship.lives <= 0) continue;
    if (ship.target !== null) ship.x = clampShip(ship.target);
    ship.inv = Math.max(0, ship.inv - dt);
    ship.cooldown -= dt;
    const own = game.bullets.filter((b) => b.owner === index).length;
    if (ship.cooldown <= 0 && own < MAX_BULLETS) {
      game.bullets.push({ x: ship.x, y: SHIP_Y - SHIP_H / 2, owner: index });
      ship.cooldown = FIRE_COOLDOWN;
    }
  }

  const fleet = game.fleet;
  fleet.x += fleet.dir * fleetSpeed(game) * dt;
  const { minCol, maxCol, maxRow } = fleetBounds(game);
  const left = fleet.x + minCol * CELL_W + (CELL_W - ALIEN_W) / 2;
  const right = fleet.x + maxCol * CELL_W + (CELL_W + ALIEN_W) / 2;
  if ((fleet.dir > 0 && right > W - 2) || (fleet.dir < 0 && left < 2)) {
    fleet.x -= fleet.dir > 0 ? right - (W - 2) : left - 2;
    fleet.dir *= -1;
    fleet.y += STEP_DOWN;
  }

  const total = ROWS * COLS;
  game.animTimer += dt;
  if (game.animTimer > 0.12 + 0.5 * (aliveCount(game) / total)) {
    game.animTimer = 0;
    game.anim ^= 1;
    events.push({ type: 'march' });
  }

  game.commanderCooldown = Math.max(0, game.commanderCooldown - dt);
  if (!game.versus) {
    game.fireTimer -= dt;
    if (game.fireTimer <= 0) {
      const { fire } = DIFFICULTY[game.difficulty];
      game.fireTimer = (fire * (0.6 + Math.random() * 0.8)) / (1 + 0.1 * (game.wave - 1));
      autoFire(game);
    }
  }

  game.bullets = game.bullets.filter((bullet) => {
    bullet.y -= BULLET_SPEED * dt;
    if (bullet.y < 0) return false;
    const col = Math.floor((bullet.x - fleet.x) / CELL_W);
    if (col < 0 || col >= COLS) return true;
    for (let row = ROWS - 1; row >= 0; row--) {
      if (!game.alive[row][col]) continue;
      const r = alienRect(game, row, col);
      if (bullet.x >= r.x && bullet.x <= r.x + r.w && bullet.y >= r.y && bullet.y <= r.y + r.h) {
        game.alive[row][col] = false;
        game.score += ROW_POINTS[row];
        events.push({ type: 'kill', row, col });
        return false;
      }
    }
    return true;
  });

  game.bombs = game.bombs.filter((bomb) => {
    bomb.y += BOMB_SPEED * dt;
    if (bomb.y > H) return false;
    for (const [index, ship] of game.ships.entries()) {
      if (ship.lives <= 0 || ship.inv > 0) continue;
      if (Math.abs(bomb.x - ship.x) < SHIP_W / 2 && Math.abs(bomb.y - SHIP_Y) < SHIP_H / 2) {
        ship.lives--;
        ship.inv = INVULNERABLE;
        events.push({ type: 'shipHit', ship: index });
        return false;
      }
    }
    return true;
  });

  const end = (winner) => {
    game.phase = 'over';
    game.winner = winner;
    events.push({ type: 'over' });
  };

  if (aliveCount(game) === 0) {
    if (game.versus) {
      end('ship');
      return events;
    }
    game.wave++;
    spawnWave(game);
    game.phase = 'wave';
    game.timer = 2;
    events.push({ type: 'wave' });
    return events;
  }

  const landed = fleet.y + maxRow * CELL_H + ALIEN_H >= SHIP_Y - SHIP_H / 2;
  if (landed) {
    game.ships.forEach((ship) => (ship.lives = 0));
    end('aliens');
  } else if (game.ships.every((ship) => ship.lives <= 0)) {
    end('aliens');
  }

  return events;
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/** Compact network snapshot. */
export function encode(game) {
  return {
    t: 's',
    ph: game.phase,
    tm: round2(game.timer),
    wv: game.wave,
    sc: game.score,
    w: game.winner,
    an: game.anim,
    cc: round2(game.commanderCooldown),
    f: [round2(game.fleet.x), round2(game.fleet.y), game.fleet.dir, round2(fleetSpeed(game))],
    a: game.alive.map((row) => row.reduce((mask, alive, i) => (alive ? mask | (1 << i) : mask), 0)),
    s: game.ships.map((ship) => [round2(ship.x), ship.lives, round2(ship.inv)]),
    b: game.bullets.map((b) => [round1(b.x), round1(b.y), b.owner]),
    e: game.bombs.map((b) => [round1(b.x), round1(b.y)]),
  };
}

export function decode(s) {
  return {
    phase: s.ph,
    timer: s.tm,
    wave: s.wv,
    score: s.sc,
    winner: s.w,
    anim: s.an,
    commanderCooldown: s.cc,
    fleet: { x: s.f[0], y: s.f[1], dir: s.f[2], speed: s.f[3] },
    alive: s.a.map((mask) => Array.from({ length: COLS }, (_, i) => Boolean(mask & (1 << i)))),
    ships: s.s.map(([x, lives, inv]) => ({ x, lives, inv, target: null })),
    bullets: s.b.map(([x, y, owner]) => ({ x, y, owner })),
    bombs: s.e.map(([x, y]) => ({ x, y })),
  };
}
