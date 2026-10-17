export const W = 100;
export const H = 160;
export const MALLET_R = 7;
export const PUCK_R = 3.2;
export const GOAL_W = 28;
export const WIN_SCORE = 7;
export const SIDES = ['bottom', 'top'];

const FRICTION = 0.992;
const WALL_BOUNCE = 0.92;
const MALLET_PUSH = 1.15;
const MAX_PUCK = 160;
const COUNTDOWN = 3;
const SERVE_DELAY = 1.1;

export const other = (side) => (side === 'bottom' ? 'top' : 'bottom');

export function halfBounds(side) {
  return side === 'bottom'
    ? { minY: H / 2 + MALLET_R + 1, maxY: H - MALLET_R - 2 }
    : { minY: MALLET_R + 2, maxY: H / 2 - MALLET_R - 1 };
}

export function clampMallet(side, x, y) {
  const { minY, maxY } = halfBounds(side);
  return {
    x: Math.min(W - MALLET_R - 1, Math.max(MALLET_R + 1, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

const centerPuck = () => ({ x: W / 2, y: H / 2, vx: 0, vy: 0 });

export function createMatch() {
  return {
    phase: 'countdown',
    timer: COUNTDOWN,
    puck: centerPuck(),
    mallets: {
      bottom: { x: W / 2, y: H - 22, px: W / 2, py: H - 22 },
      top: { x: W / 2, y: 22, px: W / 2, py: 22 },
    },
    score: { bottom: 0, top: 0 },
    serveTo: Math.random() < 0.5 ? 'bottom' : 'top',
    winner: null,
  };
}

function launch(match) {
  const angle = (Math.random() * 2 - 1) * (Math.PI / 5);
  const dir = match.serveTo === 'bottom' ? 1 : -1;
  const speed = 55;
  match.puck = {
    x: W / 2,
    y: H / 2,
    vx: speed * Math.sin(angle),
    vy: dir * speed * Math.cos(angle),
  };
}

function collideMallet(match, side) {
  const puck = match.puck;
  const m = match.mallets[side];
  const dx = puck.x - m.x;
  const dy = puck.y - m.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const min = MALLET_R + PUCK_R;
  if (dist >= min) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  puck.x = m.x + nx * min;
  puck.y = m.y + ny * min;

  const mvx = (m.x - m.px) * 55;
  const mvy = (m.y - m.py) * 55;
  const relVx = puck.vx - mvx;
  const relVy = puck.vy - mvy;
  const vn = relVx * nx + relVy * ny;
  if (vn >= 0) {
    puck.vx += mvx * 0.35;
    puck.vy += mvy * 0.35;
  } else {
    puck.vx -= (1 + MALLET_PUSH) * vn * nx;
    puck.vy -= (1 + MALLET_PUSH) * vn * ny;
    puck.vx += mvx * 0.45;
    puck.vy += mvy * 0.45;
  }

  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed > MAX_PUCK) {
    puck.vx = (puck.vx / speed) * MAX_PUCK;
    puck.vy = (puck.vy / speed) * MAX_PUCK;
  }
  return true;
}

/**
 * Advances the match by dt seconds (mutates it).
 * Returns events: 'hit', 'wall', 'point', 'over'.
 */
export function step(match, dt) {
  const events = [];
  if (match.phase === 'over') return events;

  for (const side of SIDES) {
    const m = match.mallets[side];
    m.px = m.x;
    m.py = m.y;
  }

  if (match.phase === 'countdown' || match.phase === 'serve') {
    match.timer -= dt;
    if (match.timer <= 0) {
      match.phase = 'play';
      launch(match);
    }
    return events;
  }

  const puck = match.puck;
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;
  puck.vx *= FRICTION;
  puck.vy *= FRICTION;

  const goalLeft = (W - GOAL_W) / 2;
  const goalRight = (W + GOAL_W) / 2;
  const inGoalX = puck.x > goalLeft && puck.x < goalRight;

  if (puck.x < PUCK_R) {
    puck.x = PUCK_R;
    puck.vx = Math.abs(puck.vx) * WALL_BOUNCE;
    events.push('wall');
  } else if (puck.x > W - PUCK_R) {
    puck.x = W - PUCK_R;
    puck.vx = -Math.abs(puck.vx) * WALL_BOUNCE;
    events.push('wall');
  }

  if (puck.y < PUCK_R) {
    if (inGoalX) {
      // fall through to scoring
    } else {
      puck.y = PUCK_R;
      puck.vy = Math.abs(puck.vy) * WALL_BOUNCE;
      events.push('wall');
    }
  } else if (puck.y > H - PUCK_R) {
    if (inGoalX) {
      // fall through
    } else {
      puck.y = H - PUCK_R;
      puck.vy = -Math.abs(puck.vy) * WALL_BOUNCE;
      events.push('wall');
    }
  }

  for (const side of SIDES) {
    if (collideMallet(match, side)) events.push('hit');
  }

  if (puck.y < -PUCK_R * 2 || puck.y > H + PUCK_R * 2) {
    const scorer = puck.y < 0 ? 'bottom' : 'top';
    match.score[scorer]++;
    match.lastScorer = scorer;
    match.serveTo = other(scorer);
    match.puck = centerPuck();
    events.push('point');
    if (match.score[scorer] >= WIN_SCORE) {
      match.phase = 'over';
      match.winner = scorer;
      events.push('over');
    } else {
      match.phase = 'serve';
      match.timer = SERVE_DELAY;
    }
  }

  return events;
}
