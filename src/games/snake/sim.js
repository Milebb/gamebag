export const COLS = 15;
export const ROWS = 20;
export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

const TICK_MS = { easy: 180, medium: 130, hard: 95 };
const WIN_FOOD = 12;

export function tickMs(difficulty) {
  return TICK_MS[difficulty] ?? TICK_MS.medium;
}

function cellKey(c) {
  return `${c.x},${c.y}`;
}

function randomEmpty(occupied) {
  const free = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)];
}

function makeSnake(id, body, dir) {
  return { id, body, dir, nextDir: dir, alive: true, grow: 0, score: 0 };
}

export function createMatch({ players = 1, difficulty = 'medium' } = {}) {
  const snakes = [
    makeSnake(0, [
      { x: 4, y: 10 },
      { x: 3, y: 10 },
      { x: 2, y: 10 },
    ], 'right'),
  ];
  if (players > 1) {
    snakes.push(
      makeSnake(1, [
        { x: 10, y: 10 },
        { x: 11, y: 10 },
        { x: 12, y: 10 },
      ], 'left'),
    );
  }
  const occupied = new Set(snakes.flatMap((s) => s.body.map(cellKey)));
  return {
    phase: 'play',
    difficulty,
    snakes,
    food: randomEmpty(occupied),
    winner: null,
    tick: 0,
  };
}

export function setDir(snake, dir) {
  if (!DIRS[dir] || OPPOSITE[snake.dir] === dir) return;
  snake.nextDir = dir;
}

function occupiedSet(match, ignoreTailOf = null) {
  const set = new Set();
  for (const snake of match.snakes) {
    if (!snake.alive) continue;
    const body = snake.body;
    const last = body.length - 1;
    body.forEach((c, i) => {
      if (ignoreTailOf === snake && i === last && snake.grow <= 0) return;
      set.add(cellKey(c));
    });
  }
  return set;
}

/**
 * Advances one discrete tick. Returns events: 'eat', 'die', 'over'.
 */
export function stepTick(match) {
  const events = [];
  if (match.phase !== 'play') return events;
  match.tick++;

  for (const snake of match.snakes) {
    if (!snake.alive) continue;
    snake.dir = snake.nextDir;
    const head = snake.body[0];
    const d = DIRS[snake.dir];
    const next = { x: head.x + d.x, y: head.y + d.y };

    if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) {
      snake.alive = false;
      events.push({ t: 'die', id: snake.id });
      continue;
    }

    const occ = occupiedSet(match, snake);
    if (occ.has(cellKey(next))) {
      snake.alive = false;
      events.push({ t: 'die', id: snake.id });
      continue;
    }

    snake.body.unshift(next);
    if (match.food && next.x === match.food.x && next.y === match.food.y) {
      snake.grow += 1;
      snake.score += 1;
      events.push({ t: 'eat', id: snake.id });
      const after = occupiedSet(match);
      match.food = randomEmpty(after);
    } else if (snake.grow > 0) {
      snake.grow -= 1;
    } else {
      snake.body.pop();
    }
  }

  // Head-on collision same cell
  const heads = new Map();
  for (const snake of match.snakes) {
    if (!snake.alive) continue;
    const key = cellKey(snake.body[0]);
    if (heads.has(key)) {
      snake.alive = false;
      heads.get(key).alive = false;
      events.push({ t: 'die', id: snake.id }, { t: 'die', id: heads.get(key).id });
    } else {
      heads.set(key, snake);
    }
  }

  const alive = match.snakes.filter((s) => s.alive);
  if (match.snakes.length === 1) {
    if (!alive.length) {
      match.phase = 'over';
      match.winner = null;
      events.push({ t: 'over' });
    } else if (alive[0].score >= WIN_FOOD) {
      match.phase = 'over';
      match.winner = 0;
      events.push({ t: 'over' });
    }
  } else if (alive.length <= 1) {
    match.phase = 'over';
    match.winner = alive[0]?.id ?? null;
    if (alive.length === 0) match.winner = null;
    events.push({ t: 'over' });
  } else {
    for (const s of alive) {
      if (s.score >= WIN_FOOD) {
        match.phase = 'over';
        match.winner = s.id;
        events.push({ t: 'over' });
        break;
      }
    }
  }

  return events;
}

export function encode(match) {
  return {
    ph: match.phase,
    w: match.winner,
    f: match.food ? [match.food.x, match.food.y] : null,
    s: match.snakes.map((snake) => ({
      a: snake.alive ? 1 : 0,
      d: snake.dir,
      sc: snake.score,
      b: snake.body.flatMap((c) => [c.x, c.y]),
    })),
  };
}

export function decode(data) {
  return {
    phase: data.ph,
    winner: data.w,
    food: data.f ? { x: data.f[0], y: data.f[1] } : null,
    snakes: data.s.map((s, id) => ({
      id,
      alive: !!s.a,
      dir: s.d,
      nextDir: s.d,
      score: s.sc,
      grow: 0,
      body: Array.from({ length: s.b.length / 2 }, (_, i) => ({ x: s.b[i * 2], y: s.b[i * 2 + 1] })),
    })),
    tick: 0,
  };
}

/** Simple AI for solo "walls" practice — steers toward food, avoids walls/self. */
export function aiDir(match, snakeId = 0) {
  const snake = match.snakes[snakeId];
  if (!snake?.alive || !match.food) return snake?.dir ?? 'right';
  const head = snake.body[0];
  const food = match.food;
  const options = ['up', 'down', 'left', 'right'].filter((d) => d !== OPPOSITE[snake.dir]);
  const occ = occupiedSet(match, snake);

  const safe = options.filter((d) => {
    const n = { x: head.x + DIRS[d].x, y: head.y + DIRS[d].y };
    if (n.x < 0 || n.x >= COLS || n.y < 0 || n.y >= ROWS) return false;
    return !occ.has(cellKey(n));
  });
  if (!safe.length) return snake.dir;

  safe.sort((a, b) => {
    const na = { x: head.x + DIRS[a].x, y: head.y + DIRS[a].y };
    const nb = { x: head.x + DIRS[b].x, y: head.y + DIRS[b].y };
    const da = Math.abs(na.x - food.x) + Math.abs(na.y - food.y);
    const db = Math.abs(nb.x - food.x) + Math.abs(nb.y - food.y);
    return da - db;
  });
  return safe[0];
}
