import { W, H, PUCK_R, clampMallet } from './physics.js';

const SPEED = { easy: 55, medium: 75, hard: 100 };
const REACTION = { easy: 0.4, medium: 0.55, hard: 0.72 };
const AIM_ERROR = { easy: 14, medium: 9, hard: 4 };

/** Returns an update(match, dt) that moves the top mallet. */
export function createAi(difficulty = 'medium') {
  let errorX = 0;
  let wasIncoming = false;

  return (match, dt) => {
    const { puck } = match;
    const incoming = match.phase === 'play' && puck.vy < 0;
    if (incoming && !wasIncoming) errorX = (Math.random() * 2 - 1) * AIM_ERROR[difficulty];
    wasIncoming = incoming;

    const noticed = incoming && puck.y < H * REACTION[difficulty];
    let tx = W / 2;
    let ty = 28;
    if (noticed) {
      const t = Math.max(0.05, (28 - puck.y) / Math.min(-1, puck.vy));
      tx = puck.x + puck.vx * Math.min(t, 0.35) + errorX;
      ty = Math.max(PUCK_R + 10, Math.min(H / 2 - 10, puck.y - 8));
    } else if (incoming) {
      tx = puck.x * 0.4 + W / 2 * 0.6;
    }

    const m = match.mallets.top;
    const max = SPEED[difficulty] * dt;
    const dx = Math.max(-max, Math.min(max, tx - m.x));
    const dy = Math.max(-max, Math.min(max, ty - m.y));
    const next = clampMallet('top', m.x + dx, m.y + dy);
    m.x = next.x;
    m.y = next.y;
  };
}
