export const W = 100;
export const H = 160;
export const PADDLE_W = 22;
export const PADDLE_H = 3;
export const PADDLE_INSET = 10;
export const BALL = 3;
export const WIN_SCORE = 7;

const START_SPEED = 75;
const MAX_SPEED = 190;
const SPEEDUP = 1.07;
const MAX_ANGLE = Math.PI / 3;
const COUNTDOWN = 3;
const SERVE_DELAY = 1;

export const SIDES = ['bottom', 'top'];
export const other = (side) => (side === 'bottom' ? 'top' : 'bottom');
export const paddleY = (side) => (side === 'bottom' ? H - PADDLE_INSET : PADDLE_INSET);
export const clampPaddle = (x) => Math.min(W - PADDLE_W / 2, Math.max(PADDLE_W / 2, x));

const centerBall = () => ({ x: W / 2, y: H / 2, vx: 0, vy: 0 });

export function createMatch() {
  return {
    phase: 'countdown',
    timer: COUNTDOWN,
    ball: centerBall(),
    paddles: { bottom: W / 2, top: W / 2 },
    score: { bottom: 0, top: 0 },
    serveTo: Math.random() < 0.5 ? 'bottom' : 'top',
    winner: null,
  };
}

function launch(match) {
  const angle = (Math.random() * 2 - 1) * (Math.PI / 6);
  const dir = match.serveTo === 'bottom' ? 1 : -1;
  match.ball = { x: W / 2, y: H / 2, vx: START_SPEED * Math.sin(angle), vy: dir * START_SPEED * Math.cos(angle) };
}

function bounceOffPaddle(match, side) {
  const ball = match.ball;
  const r = BALL / 2;
  const dir = side === 'bottom' ? 1 : -1;
  if (ball.vy * dir <= 0) return false;

  const y = paddleY(side);
  const face = y - (dir * PADDLE_H) / 2;
  const back = y + (dir * PADDLE_H) / 2;
  const touchesFace = dir > 0 ? ball.y + r >= face && ball.y - r <= back : ball.y - r <= face && ball.y + r >= back;
  const x = match.paddles[side];
  if (!touchesFace || Math.abs(ball.x - x) > PADDLE_W / 2 + r) return false;

  const offset = Math.max(-1, Math.min(1, (ball.x - x) / (PADDLE_W / 2)));
  const speed = Math.min(MAX_SPEED, Math.hypot(ball.vx, ball.vy) * SPEEDUP);
  const angle = offset * MAX_ANGLE;
  ball.vx = speed * Math.sin(angle);
  ball.vy = -dir * speed * Math.cos(angle);
  ball.y = face - dir * r;
  return true;
}

/**
 * Advances the match by dt seconds (mutates it).
 * Returns events: 'hit', 'wall', 'point' (match.lastScorer is set) and 'over'.
 */
export function step(match, dt) {
  const events = [];
  if (match.phase === 'over') return events;

  if (match.phase === 'countdown' || match.phase === 'serve') {
    match.timer -= dt;
    if (match.timer <= 0) {
      match.phase = 'play';
      launch(match);
    }
    return events;
  }

  const ball = match.ball;
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

  for (const side of SIDES) {
    if (bounceOffPaddle(match, side)) events.push('hit');
  }

  if (ball.y > H + BALL * 2 || ball.y < -BALL * 2) {
    const scorer = ball.y > H ? 'top' : 'bottom';
    match.score[scorer]++;
    match.lastScorer = scorer;
    match.serveTo = other(scorer);
    match.ball = centerBall();
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
