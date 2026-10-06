import { W, H, BALL, paddleY, clampPaddle } from './physics.js';

const SPEED = { easy: 45, medium: 60, hard: 80 };
// Paddle reach is ±12.5 around its center, so aim errors beyond that are misses.
const AIM_ERROR = { easy: 22, medium: 17, hard: 14 };
// The AI only starts tracking once the ball is above this fraction of the field height.
const REACTION = { easy: 0.45, medium: 0.6, hard: 0.75 };

/** Where the ball will cross height y, including bounces off the side walls. */
function predictX(ball, y) {
  if (ball.vy === 0) return ball.x;
  const r = BALL / 2;
  const span = W - 2 * r;
  let x = ball.x + ball.vx * ((y - ball.y) / ball.vy) - r;
  x = ((x % (2 * span)) + 2 * span) % (2 * span);
  if (x > span) x = 2 * span - x;
  return x + r;
}

/** Returns an update(match, dt) function that moves the top paddle. */
export function createAi(difficulty = 'medium') {
  let error = 0;
  let wasIncoming = false;

  return (match, dt) => {
    const { ball } = match;
    const incoming = match.phase === 'play' && ball.vy < 0;
    if (incoming && !wasIncoming) error = (Math.random() * 2 - 1) * AIM_ERROR[difficulty];
    wasIncoming = incoming;

    const noticed = incoming && ball.y < H * REACTION[difficulty];
    const target = noticed ? predictX(ball, paddleY('top')) + error : incoming ? match.paddles.top : W / 2;
    const x = match.paddles.top;
    const maxMove = SPEED[difficulty] * dt;
    match.paddles.top = clampPaddle(x + Math.max(-maxMove, Math.min(maxMove, target - x)));
  };
}
