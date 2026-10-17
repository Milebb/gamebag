export const W = 100;
export const H = 160;
export const PADDLE_W = 18;
export const PADDLE_H = 3;
export const BALL = 2.6;
export const BRICK_COLS = 8;
export const BRICK_ROWS = 6;
export const BRICK_W = 11;
export const BRICK_H = 5;
export const BRICK_GAP = 1;
export const BRICK_TOP = 22;

const START_SPEED = { easy: 55, medium: 70, hard: 88 };
const PADDLE_Y = { 0: H - 14, 1: H - 28 };

export function clampPaddle(x, width = PADDLE_W) {
  return Math.min(W - width / 2, Math.max(width / 2, x));
}

function makeBricks() {
  const bricks = [];
  const colors = ['#ff2e88', '#ffe14d', '#39ff14', '#22e4ff', '#b14dff', '#ff2e88'];
  const totalW = BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP;
  const left = (W - totalW) / 2;
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      bricks.push({
        x: left + c * (BRICK_W + BRICK_GAP),
        y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
        hp: r < 2 ? 2 : 1,
        color: colors[r],
        alive: true,
      });
    }
  }
  return bricks;
}

export function createGame({ paddles = 1, difficulty = 'medium' } = {}) {
  const paddleList = Array.from({ length: paddles }, (_, i) => ({
    x: W / 2,
    y: PADDLE_Y[i] ?? H - 14 - i * 14,
    w: PADDLE_W,
  }));
  return {
    phase: 'serve',
    timer: 1.2,
    ball: { x: W / 2, y: paddleList[0].y - 6, vx: 0, vy: 0 },
    paddles: paddleList,
    bricks: makeBricks(),
    lives: 3,
    score: 0,
    difficulty,
    winner: null,
    speed: START_SPEED[difficulty] ?? START_SPEED.medium,
  };
}

function launch(game) {
  const angle = (Math.random() * 2 - 1) * (Math.PI / 4);
  game.ball.vx = game.speed * Math.sin(angle);
  game.ball.vy = -game.speed * Math.cos(angle);
}

function bouncePaddle(game, paddle) {
  const ball = game.ball;
  const r = BALL / 2;
  if (ball.vy <= 0) return false;
  const top = paddle.y - PADDLE_H / 2;
  const bottom = paddle.y + PADDLE_H / 2;
  if (ball.y + r < top || ball.y - r > bottom) return false;
  if (Math.abs(ball.x - paddle.x) > paddle.w / 2 + r) return false;

  const offset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / (paddle.w / 2)));
  const speed = Math.min(140, Math.hypot(ball.vx, ball.vy) * 1.03);
  const angle = offset * (Math.PI / 3);
  ball.vx = speed * Math.sin(angle);
  ball.vy = -Math.abs(speed * Math.cos(angle));
  ball.y = top - r;
  return true;
}

function hitBrick(ball, brick) {
  const r = BALL / 2;
  const closestX = Math.max(brick.x, Math.min(ball.x, brick.x + BRICK_W));
  const closestY = Math.max(brick.y, Math.min(ball.y, brick.y + BRICK_H));
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  if (dx * dx + dy * dy > r * r) return false;

  const overlapL = ball.x + r - brick.x;
  const overlapR = brick.x + BRICK_W - (ball.x - r);
  const overlapT = ball.y + r - brick.y;
  const overlapB = brick.y + BRICK_H - (ball.y - r);
  const minX = Math.min(overlapL, overlapR);
  const minY = Math.min(overlapT, overlapB);
  if (minX < minY) ball.vx *= -1;
  else ball.vy *= -1;
  return true;
}

/**
 * Advances by dt. Events: 'hit', 'brick', 'wall', 'life', 'clear', 'over'.
 */
export function step(game, dt) {
  const events = [];
  if (game.phase === 'over') return events;

  if (game.phase === 'serve') {
    game.timer -= dt;
    const p = game.paddles[0];
    game.ball.x = p.x;
    game.ball.y = p.y - 6;
    if (game.timer <= 0) {
      game.phase = 'play';
      launch(game);
    }
    return events;
  }

  const ball = game.ball;
  const r = BALL / 2;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x < r) {
    ball.x = r;
    ball.vx = Math.abs(ball.vx);
    events.push('wall');
  } else if (ball.x > W - r) {
    ball.x = W - r;
    ball.vx = -Math.abs(ball.vx);
    events.push('wall');
  }
  if (ball.y < r) {
    ball.y = r;
    ball.vy = Math.abs(ball.vy);
    events.push('wall');
  }

  for (const paddle of game.paddles) {
    if (bouncePaddle(game, paddle)) events.push('hit');
  }

  for (const brick of game.bricks) {
    if (!brick.alive) continue;
    if (!hitBrick(ball, brick)) continue;
    brick.hp -= 1;
    if (brick.hp <= 0) {
      brick.alive = false;
      game.score += 10;
      events.push('brick');
    } else {
      game.score += 3;
      events.push('hit');
    }
    break;
  }

  if (game.bricks.every((b) => !b.alive)) {
    game.phase = 'over';
    game.winner = 'clear';
    events.push('clear', 'over');
    return events;
  }

  if (ball.y > H + 8) {
    game.lives -= 1;
    events.push('life');
    if (game.lives <= 0) {
      game.phase = 'over';
      game.winner = 'lose';
      events.push('over');
    } else {
      game.phase = 'serve';
      game.timer = 1;
      ball.vx = 0;
      ball.vy = 0;
    }
  }

  return events;
}

export function encode(game) {
  return {
    ph: game.phase,
    tm: Math.round(game.timer * 100) / 100,
    b: [round(game.ball.x), round(game.ball.y), round(game.ball.vx), round(game.ball.vy)],
    p: game.paddles.map((p) => round(p.x)),
    br: game.bricks.map((b) => (b.alive ? b.hp : 0)),
    lv: game.lives,
    sc: game.score,
    w: game.winner,
  };
}

function round(v) {
  return Math.round(v * 100) / 100;
}

export function decode(data, template) {
  const game = createGame({ paddles: data.p.length, difficulty: template?.difficulty ?? 'medium' });
  game.phase = data.ph;
  game.timer = data.tm;
  game.ball = { x: data.b[0], y: data.b[1], vx: data.b[2], vy: data.b[3] };
  data.p.forEach((x, i) => {
    if (game.paddles[i]) game.paddles[i].x = x;
  });
  data.br.forEach((hp, i) => {
    if (!game.bricks[i]) return;
    game.bricks[i].hp = hp;
    game.bricks[i].alive = hp > 0;
  });
  game.lives = data.lv;
  game.score = data.sc;
  game.winner = data.w;
  return game;
}
