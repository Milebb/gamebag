import {
  W,
  H,
  PADDLE_W,
  PADDLE_H,
  BALL,
  BRICK_W,
  BRICK_H,
  createGame,
  step,
  clampPaddle,
  encode,
  decode,
} from './sim.js';
import { sound } from '../../sound.js';

const STEP = 1 / 120;
const SEND_MS = 1000 / 25;
const KEY_SPEED = 110;

const TITLES = { ai: 'SAM', local: 'ZAJEDNO', online: 'ONLINE ZAJEDNO' };

/**
 * mode: 'ai' (solo) | 'local' (two paddles) | 'online' (co-op, host authority)
 */
export function start(root, { mode, difficulty = 'medium', net = null, isHost = false, onExit }) {
  const online = mode === 'online';
  const authority = !online || isHost;
  const paddleCount = mode === 'ai' ? 1 : 2;
  const myPaddle = online && !isHost ? 1 : 0;

  let game = authority ? createGame({ paddles: paddleCount, difficulty }) : null;
  let ended = false;
  let raf = 0;
  let lastFrame = 0;
  let accumulator = 0;
  let lastSent = 0;
  let lastPaddleSent = null;
  const targets = Array(paddleCount).fill(null);
  const keys = new Set();
  const pointers = new Map();

  root.innerHTML = `
    <main class="screen pong">
      <div class="topbar">
        <button class="btn btn-small btn-ghost" data-action="exit">&lt; IZLAZ</button>
        <span class="title">CIGLE · ${TITLES[mode]}</span>
      </div>
      <div class="pong-wrap">
        <canvas class="pong-canvas"></canvas>
        <div class="pong-overlay" hidden>
          <p class="pong-result"></p>
          <button class="btn btn-primary" data-action="again">NOVA IGRA</button>
          <button class="btn btn-ghost" data-action="exit">IZBORNIK</button>
        </div>
      </div>
      <p class="hint">${
        mode === 'local'
          ? 'DVA REKETA — SVAKI PRATI SVOJ PRST'
          : online && !isHost
            ? 'TI SI GORNJI REKET · VUCI LIJEVO-DESNO'
            : 'VUCI REKET LIJEVO-DESNO'
      }</p>
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

  function fieldX(event) {
    const rect = canvas.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * W;
  }

  function paddleForY(clientY) {
    if (mode !== 'local' || !game) return myPaddle;
    const rect = canvas.getBoundingClientRect();
    const y = ((clientY - rect.top) / rect.height) * H;
    // Lower half of screen → bottom paddle (0); upper → paddle 1
    return y > H * 0.72 ? 0 : 1;
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* optional */
    }
    const id = paddleForY(event.clientY);
    pointers.set(event.pointerId, id);
    targets[id] = fieldX(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    let id = pointers.get(event.pointerId);
    if (id == null && event.pointerType === 'mouse') id = paddleForY(event.clientY);
    if (id != null) targets[id] = fieldX(event);
  });
  const release = (event) => pointers.delete(event.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const onKeyDown = (event) => keys.add(event.key);
  const onKeyUp = (event) => keys.delete(event.key);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function applyKeys(dt) {
    const move = (id, left, right) => {
      const dir = (keys.has(right) ? 1 : 0) - (keys.has(left) ? 1 : 0);
      if (!dir || !game?.paddles[id]) return;
      const cur = targets[id] ?? game.paddles[id].x;
      targets[id] = clampPaddle(cur + dir * KEY_SPEED * dt);
    };
    move(myPaddle, 'ArrowLeft', 'ArrowRight');
    if (mode === 'local') move(1, 'a', 'd');
  }

  function restart() {
    if (!authority) return net.send({ t: 'again' });
    if (game?.phase !== 'over' || ended) return;
    game = createGame({ paddles: paddleCount, difficulty });
    overlay.hidden = true;
  }

  function showGameOver() {
    if (game.winner === 'clear') {
      resultEl.textContent = `POBJEDA!\nBODOVI: ${game.score}`;
      sound.win();
    } else {
      resultEl.textContent = `KRAJ!\nBODOVI: ${game.score}`;
      sound.lose();
    }
    overlay.hidden = false;
  }

  function playEvents(events) {
    for (const e of events) {
      if (e === 'hit') sound.hit();
      else if (e === 'brick') sound.kill();
      else if (e === 'wall') sound.wall();
      else if (e === 'life') {
        sound.miss();
        navigator.vibrate?.(50);
      } else if (e === 'clear') sound.wave();
      else if (e === 'over') showGameOver();
    }
  }

  function tick(dt) {
    game.paddles.forEach((p, i) => {
      if (targets[i] != null) p.x = clampPaddle(targets[i], p.w);
    });
    playEvents(step(game, dt));
  }

  function sendPaddle(now) {
    const x = targets[myPaddle];
    if (x == null || x === lastPaddleSent || now - lastSent < SEND_MS) return;
    lastSent = now;
    lastPaddleSent = x;
    net.send({ t: 'p', x: Math.round(clampPaddle(x) * 100) / 100 });
  }

  function receiveSnapshot(msg) {
    const prev = game;
    game = decode(msg, { difficulty });
    if (!prev) return;
    if (game.phase === 'over' && prev.phase !== 'over') showGameOver();
    else if (game.phase !== 'over' && prev.phase === 'over') overlay.hidden = true;
    if (game.score > prev.score) sound.kill();
    if (game.lives < prev.lives) {
      sound.miss();
      navigator.vibrate?.(50);
    }
  }

  function draw() {
    ctx.fillStyle = '#0b0b1a';
    ctx.fillRect(0, 0, W, H);

    if (!game) {
      ctx.fillStyle = '#ffe14d';
      ctx.font = '5px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ČEKAM...', W / 2, H / 2);
      return;
    }

    ctx.fillStyle = 'rgba(122,122,168,0.9)';
    ctx.font = '4px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`BOD ${game.score}`, 3, 8);
    ctx.textAlign = 'right';
    ctx.fillText(`♥ ${game.lives}`, W - 3, 8);

    for (const brick of game.bricks) {
      if (!brick.alive) continue;
      ctx.fillStyle = brick.color;
      ctx.shadowColor = brick.color;
      ctx.shadowBlur = 3;
      ctx.globalAlpha = brick.hp > 1 ? 1 : 0.75;
      ctx.fillRect(brick.x, brick.y, BRICK_W, BRICK_H);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    const colors = ['#ff2e88', '#22e4ff'];
    game.paddles.forEach((p, i) => {
      // Guest can show local paddle position for responsiveness
      const x =
        !authority && i === myPaddle && targets[myPaddle] != null
          ? clampPaddle(targets[myPaddle])
          : p.x;
      ctx.fillStyle = ctx.shadowColor = colors[i % colors.length];
      ctx.shadowBlur = 4;
      ctx.fillRect(x - p.w / 2, p.y - PADDLE_H / 2, p.w, PADDLE_H);
      ctx.shadowBlur = 0;
    });

    const showBall = game.phase === 'play' || (game.phase === 'serve' && Math.floor(performance.now() / 140) % 2 === 0);
    if (showBall) {
      ctx.fillStyle = ctx.shadowColor = '#ffe14d';
      ctx.shadowBlur = 4;
      ctx.fillRect(game.ball.x - BALL / 2, game.ball.y - BALL / 2, BALL, BALL);
      ctx.shadowBlur = 0;
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    applyKeys(dt);

    if (authority && game && !ended) {
      accumulator += dt;
      while (accumulator >= STEP) {
        accumulator -= STEP;
        tick(STEP);
      }
      if (online && now - lastSent >= SEND_MS) {
        lastSent = now;
        net.send({ t: 's', ...encode(game) });
      }
    } else if (!ended && online) {
      sendPaddle(now);
    }

    draw();
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
        if (msg.t === 'p' && Number.isFinite(msg.x) && game?.paddles[1]) {
          targets[1] = clampPaddle(msg.x);
        } else if (msg.t === 'again') restart();
      } else if (msg.t === 's') {
        receiveSnapshot(msg);
      }
    });
    net.onClose(opponentLeft);
    if (isHost) net.onResume(() => game && net.send({ t: 's', ...encode(game) }));
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
