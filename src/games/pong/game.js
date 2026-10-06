import { W, H, PADDLE_W, PADDLE_H, BALL, SIDES, createMatch, step, clampPaddle, paddleY } from './physics.js';
import { createAi } from './ai.js';
import { sound } from '../../sound.js';

const STEP = 1 / 120;
const SEND_MS = 1000 / 30;
const KEY_SPEED = 110;
const COLORS = { bottom: '#ff2e88', top: '#22e4ff', ball: '#ffe14d', line: '#5a5a8a', score: 'rgba(122, 122, 168, 0.3)' };

const NAMES = {
  ai: { bottom: 'TI', top: 'RAČUNALO' },
  local: { bottom: 'IGRAČ 1', top: 'IGRAČ 2' },
  host: { bottom: 'TI', top: 'PRIJATELJ' },
  guest: { bottom: 'PRIJATELJ', top: 'TI' },
};
const TITLES = { ai: 'PROTIV RAČUNALA', local: 'DVOJE', online: 'ONLINE' };

const round2 = (v) => Math.round(v * 100) / 100;
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * mode: 'ai' | 'local' | 'online'
 * Online, the host (bottom paddle) runs the physics and streams snapshots;
 * the guest (top paddle) sends its paddle position and sees the field rotated 180°.
 */
export function start(root, { mode, difficulty = 'medium', net = null, isHost = false, onExit }) {
  const online = mode === 'online';
  const authority = !online || isHost;
  const flipped = online && !isHost;
  const mySide = flipped ? 'top' : 'bottom';
  const names = online ? NAMES[isHost ? 'host' : 'guest'] : NAMES[mode];
  const ai = mode === 'ai' ? createAi(difficulty) : null;

  let match = authority ? createMatch() : null;
  let snapshotAt = 0;
  let ended = false;
  let raf = 0;
  let lastFrame = 0;
  let accumulator = 0;
  let lastSent = 0;
  let lastPaddleSent = null;

  // Finger/keyboard targets in field coordinates.
  const targets = { bottom: null, top: null };
  // Guest-side smoothed render positions.
  const smooth = { ball: null, bottom: W / 2 };
  const keys = new Set();

  root.innerHTML = `
    <main class="screen pong">
      <div class="topbar">
        <button class="btn btn-small btn-ghost" data-action="exit">&lt; IZLAZ</button>
        <span class="title">PONG · ${TITLES[mode]}</span>
      </div>
      <div class="pong-wrap">
        <canvas class="pong-canvas"></canvas>
        <div class="pong-overlay" hidden>
          <p class="pong-result"></p>
          <button class="btn btn-primary" data-action="again">NOVA IGRA</button>
          <button class="btn btn-ghost" data-action="exit">IZBORNIK</button>
        </div>
      </div>
      <p class="hint">${mode === 'local' ? 'SVATKO VUČE PRSTOM NA SVOJOJ POLOVICI' : 'VUCI PRSTOM LIJEVO-DESNO'}</p>
    </main>`;

  const screen = root.querySelector('.screen');
  const wrap = root.querySelector('.pong-wrap');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const overlay = root.querySelector('.pong-overlay');
  const resultEl = root.querySelector('.pong-result');
  const againBtn = root.querySelector('[data-action="again"]');

  screen.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'exit') onExit();
    if (action === 'again') {
      sound.click();
      restart();
    }
  });

  // --- Layout ---

  function resize() {
    const rect = wrap.getBoundingClientRect();
    const scale = Math.min(rect.width / W, rect.height / H);
    const cssW = Math.floor(W * scale);
    const cssH = Math.floor(H * scale);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(wrap);

  // --- Input ---

  const toViewX = (x) => (flipped ? W - x : x);
  const pointers = new Map();

  function fieldPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    const y = ((event.clientY - rect.top) / rect.height) * H;
    return { x: toViewX(x), y: flipped ? H - y : y };
  }

  function sideForPoint(point) {
    if (mode !== 'local') return mySide;
    return point.y > H / 2 ? 'bottom' : 'top';
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is only an improvement (keeps tracking outside the canvas).
    }
    const point = fieldPoint(event);
    const side = sideForPoint(point);
    pointers.set(event.pointerId, side);
    targets[side] = point.x;
  });
  canvas.addEventListener('pointermove', (event) => {
    const point = fieldPoint(event);
    let side = pointers.get(event.pointerId);
    if (!side && event.pointerType === 'mouse') side = sideForPoint(point);
    if (side) targets[side] = point.x;
  });
  const releasePointer = (event) => pointers.delete(event.pointerId);
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  const onKeyDown = (event) => keys.add(event.key);
  const onKeyUp = (event) => keys.delete(event.key);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function applyKeys(dt) {
    const move = (side, left, right) => {
      const dir = (keys.has(right) ? 1 : 0) - (keys.has(left) ? 1 : 0);
      if (!dir) return;
      const current = targets[side] ?? match?.paddles[side] ?? W / 2;
      // Arrow keys move "screen left/right", which is mirrored for the rotated guest view.
      targets[side] = clampPaddle(current + dir * (side === mySide && flipped ? -1 : 1) * KEY_SPEED * dt);
    };
    move(mySide, 'ArrowLeft', 'ArrowRight');
    if (mode === 'local') move('top', 'a', 'd');
  }

  // --- Game flow ---

  function restart() {
    if (!authority) return net.send({ t: 'again' });
    if (match.phase !== 'over' || ended) return;
    match = createMatch();
    overlay.hidden = true;
  }

  function resultText(winner) {
    if (mode === 'local') return `${names[winner]} POBJEĐUJE!`;
    if (winner === mySide) return 'POBJEDA!';
    return mode === 'ai' ? 'RAČUNALO POBJEĐUJE!' : 'PRIJATELJ POBJEĐUJE!';
  }

  function showGameOver() {
    const { winner, score } = match;
    resultEl.textContent = `${resultText(winner)}\n${score[mySide]} : ${score[mySide === 'bottom' ? 'top' : 'bottom']}`;
    overlay.hidden = false;
    if (mode === 'local' || winner === mySide) sound.win();
    else sound.lose();
  }

  function onPoint(scorer) {
    if (mode === 'local' || scorer === mySide) sound.point();
    else {
      sound.miss();
      navigator.vibrate?.(60);
    }
  }

  function playEvents(events) {
    for (const event of events) {
      if (event === 'hit') sound.hit();
      else if (event === 'wall') sound.wall();
      else if (event === 'point') onPoint(match.lastScorer);
      else if (event === 'over') showGameOver();
    }
  }

  function tick(dt) {
    for (const side of SIDES) {
      if (targets[side] !== null) match.paddles[side] = clampPaddle(targets[side]);
    }
    ai?.(match, dt);
    playEvents(step(match, dt));
  }

  function snapshot() {
    const { ball, paddles, score } = match;
    return {
      t: 's',
      b: [round2(ball.x), round2(ball.y), round2(ball.vx), round2(ball.vy)],
      p: [round2(paddles.bottom), round2(paddles.top)],
      sc: [score.bottom, score.top],
      ph: match.phase,
      tm: round2(match.timer),
      w: match.winner,
    };
  }

  function receiveSnapshot(s) {
    const prev = match;
    match = {
      phase: s.ph,
      timer: s.tm,
      ball: { x: s.b[0], y: s.b[1], vx: s.b[2], vy: s.b[3] },
      paddles: { bottom: s.p[0], top: s.p[1] },
      score: { bottom: s.sc[0], top: s.sc[1] },
      winner: s.w,
    };
    snapshotAt = performance.now();

    if (!prev) return;
    if (match.phase === 'over' && prev.phase !== 'over') showGameOver();
    else if (match.phase !== 'over' && prev.phase === 'over') overlay.hidden = true;

    for (const side of SIDES) {
      if (match.score[side] > prev.score[side]) return onPoint(side);
    }
    if (prev.phase === 'play' && match.phase === 'play') {
      if (sign(prev.ball.vy) && sign(match.ball.vy) !== sign(prev.ball.vy)) sound.hit();
      else if (sign(prev.ball.vx) && sign(match.ball.vx) !== sign(prev.ball.vx)) sound.wall();
    }
  }

  function sendPaddle(now) {
    const x = targets[mySide];
    if (x === null || x === lastPaddleSent || now - lastSent < SEND_MS) return;
    lastSent = now;
    lastPaddleSent = x;
    net.send({ t: 'p', x: round2(clampPaddle(x)) });
  }

  // --- Rendering ---

  /** Positions to draw, in field coordinates. The guest predicts the ball between snapshots. */
  function renderState(now) {
    if (authority) return { ball: match.ball, paddles: match.paddles };

    const { ball } = match;
    let predicted = { x: ball.x, y: ball.y };
    if (match.phase === 'play') {
      const t = Math.min(0.12, (now - snapshotAt) / 1000);
      const r = BALL / 2;
      let x = ball.x + ball.vx * t;
      if (x < r) x = 2 * r - x;
      if (x > W - r) x = 2 * (W - r) - x;
      predicted = { x, y: ball.y + ball.vy * t };
    }
    const prev = smooth.ball;
    smooth.ball =
      !prev || Math.hypot(predicted.x - prev.x, predicted.y - prev.y) > 12
        ? predicted
        : { x: prev.x + (predicted.x - prev.x) * 0.6, y: prev.y + (predicted.y - prev.y) * 0.6 };
    smooth.bottom += (match.paddles.bottom - smooth.bottom) * 0.5;

    return {
      ball: smooth.ball,
      paddles: { bottom: smooth.bottom, top: clampPaddle(targets.top ?? match.paddles.top) },
    };
  }

  function drawText(text, x, y, size, color, upsideDown = false) {
    ctx.save();
    ctx.translate(x, y);
    if (upsideDown) ctx.rotate(Math.PI);
    ctx.font = `${size}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function draw(now) {
    ctx.fillStyle = '#0b0b1a';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = COLORS.line;
    for (let x = 2; x < W; x += 6) ctx.fillRect(x, H / 2 - 0.5, 3, 1);

    if (!match) {
      drawText('ČEKAM...', W / 2, H / 2 - 10, 5, COLORS.ball);
      return;
    }

    const { ball, paddles } = renderState(now);
    const vx = (x) => (flipped ? W - x : x);
    const vy = (y) => (flipped ? H - y : y);
    const nearSide = flipped ? 'top' : 'bottom';
    const farSide = flipped ? 'bottom' : 'top';

    drawText(String(match.score[nearSide]), W / 2, H / 2 + 20, 18, COLORS.score);
    drawText(String(match.score[farSide]), W / 2, H / 2 - 20, 18, COLORS.score, mode === 'local');

    ctx.shadowBlur = 4;
    for (const side of SIDES) {
      ctx.fillStyle = ctx.shadowColor = COLORS[side];
      ctx.fillRect(vx(paddles[side]) - PADDLE_W / 2, vy(paddleY(side)) - PADDLE_H / 2, PADDLE_W, PADDLE_H);
    }

    const showBall = match.phase === 'play' || (match.phase === 'serve' && Math.floor(now / 150) % 2 === 0);
    if (showBall) {
      ctx.fillStyle = ctx.shadowColor = COLORS.ball;
      ctx.fillRect(vx(ball.x) - BALL / 2, vy(ball.y) - BALL / 2, BALL, BALL);
    }
    ctx.shadowBlur = 0;

    if (match.phase === 'countdown') {
      drawText(String(Math.max(1, Math.ceil(match.timer))), W / 2, H / 2 + 0.5, 16, COLORS.ball);
    }
  }

  // --- Loop ---

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    applyKeys(dt);

    if (authority) {
      if (!ended) {
        accumulator += dt;
        while (accumulator >= STEP) {
          accumulator -= STEP;
          tick(STEP);
        }
      }
      if (online && !ended && now - lastSent >= SEND_MS) {
        lastSent = now;
        net.send(snapshot());
      }
    } else if (!ended) {
      sendPaddle(now);
    }

    draw(now);
  }

  function opponentLeft() {
    if (ended) return;
    ended = true;
    resultEl.textContent = 'PRIJATELJ JE IZAŠAO';
    againBtn.hidden = true;
    overlay.hidden = false;
  }

  const sayBye = () => net.send({ t: 'bye' });

  if (online) {
    net.setHandler((msg) => {
      if (msg.t === 'bye') return opponentLeft();
      if (isHost) {
        if (msg.t === 'p' && Number.isFinite(msg.x)) targets.top = clampPaddle(msg.x);
        else if (msg.t === 'again') restart();
      } else if (msg.t === 's') {
        receiveSnapshot(msg);
      }
    });
    net.onClose(opponentLeft);
    window.addEventListener('pagehide', sayBye);
  }

  resize();
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    if (online) {
      window.removeEventListener('pagehide', sayBye);
      if (!ended) sayBye();
      net.close();
    }
  };
}
