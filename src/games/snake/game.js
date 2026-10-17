import { COLS, ROWS, createMatch, stepTick, setDir, tickMs, encode, decode } from './sim.js';
import { sound } from '../../sound.js';

const CELL = 8;
const W = COLS * CELL;
const H = ROWS * CELL;
const COLORS = {
  bg: '#0b0b1a',
  grid: '#151532',
  food: '#ffe14d',
  s0: '#ff2e88',
  s1: '#22e4ff',
  dead: '#5a5a8a',
};

const NAMES = {
  ai: ['TI'],
  local: ['IGRAČ 1', 'IGRAČ 2'],
  host: ['TI', 'PRIJATELJ'],
  guest: ['PRIJATELJ', 'TI'],
};

const TITLES = { ai: 'SAM', local: 'DVOJE', online: 'ONLINE' };

/**
 * mode: 'ai' (solo) | 'local' (versus) | 'online' (versus)
 * Host runs discrete ticks and streams snapshots; guest sends direction.
 */
export function start(root, { mode, difficulty = 'medium', net = null, isHost = false, onExit }) {
  const online = mode === 'online';
  const authority = !online || isHost;
  const players = mode === 'ai' ? 1 : 2;
  const myId = online && !isHost ? 1 : 0;
  const names = online ? NAMES[isHost ? 'host' : 'guest'] : NAMES[mode];
  // Solo AI mode: player controls; optional ghost AI off — classic solo.
  // Difficulty only affects tick speed.

  let match = authority ? createMatch({ players, difficulty }) : null;
  let ended = false;
  let raf = 0;
  let lastFrame = 0;
  let acc = 0;
  let lastSent = 0;
  let lastDirSent = null;
  const interval = tickMs(difficulty);

  root.innerHTML = `
    <main class="screen pong">
      <div class="topbar">
        <button class="btn btn-small btn-ghost" data-action="exit">&lt; IZLAZ</button>
        <span class="title">ZMIJA · ${TITLES[mode]}</span>
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
          ? 'P1: STRELICAMA · P2: WASD · ILI VUCI PRSTOM'
          : 'VUCI PRSTOM ILI STRELICAMA'
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
    ctx.imageSmoothingEnabled = false;
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(wrap);

  function applyDir(id, dir) {
    if (!match || match.phase !== 'play') return;
    const snake = match.snakes[id];
    if (!snake?.alive) return;
    if (authority) setDir(snake, dir);
    else if (id === myId) {
      net.send({ t: 'd', d: dir });
      lastDirSent = dir;
    }
  }

  const swipe = { id: null, x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    swipe.id = event.pointerId;
    swipe.x = event.clientX;
    swipe.y = event.clientY;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* optional */
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 24) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    let id = myId;
    if (mode === 'local') {
      const rect = canvas.getBoundingClientRect();
      id = (event.clientY - rect.top) / rect.height < 0.5 ? 1 : 0;
    }
    applyDir(id, dir);
  });

  const onKey = (event) => {
    const map1 = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const map2 = { w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
    if (map1[event.key]) {
      event.preventDefault();
      applyDir(mode === 'local' ? 0 : myId, map1[event.key]);
    } else if (mode === 'local' && map2[event.key]) {
      event.preventDefault();
      applyDir(1, map2[event.key]);
    }
  };
  window.addEventListener('keydown', onKey);

  function restart() {
    if (!authority) return net.send({ t: 'again' });
    if (match?.phase !== 'over' || ended) return;
    match = createMatch({ players, difficulty });
    overlay.hidden = true;
    acc = 0;
  }

  function showGameOver() {
    const { winner, snakes } = match;
    let text;
    if (players === 1) {
      text = winner === 0 ? `POBJEDA!\nHRANA: ${snakes[0].score}` : `KRAJ!\nHRANA: ${snakes[0].score}`;
    } else if (winner == null) {
      text = 'NERIJEŠENO!';
    } else if (mode === 'local') {
      text = `${names[winner]} POBJEĐUJE!\n${snakes[0].score} : ${snakes[1].score}`;
    } else {
      text = winner === myId ? `POBJEDA!\n${snakes[myId].score} : ${snakes[1 - myId].score}` : `PRIJATELJ POBJEĐUJE!\n${snakes[myId].score} : ${snakes[1 - myId].score}`;
    }
    resultEl.textContent = text;
    overlay.hidden = false;
    if (players === 1) {
      if (winner === 0) sound.win();
      else sound.lose();
    } else if (mode === 'local' || winner === myId) sound.win();
    else if (winner == null) sound.draw();
    else sound.lose();
  }

  function playEvents(events) {
    for (const e of events) {
      if (e.t === 'eat') sound.eat();
      else if (e.t === 'die') {
        sound.miss();
        navigator.vibrate?.(40);
      } else if (e.t === 'over') showGameOver();
    }
  }

  function tick() {
    playEvents(stepTick(match));
  }

  function draw() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.grid;
    for (let x = CELL; x < W; x += CELL) ctx.fillRect(x, 0, 0.5, H);
    for (let y = CELL; y < H; y += CELL) ctx.fillRect(0, y, W, 0.5);

    if (!match) {
      ctx.fillStyle = COLORS.food;
      ctx.font = '5px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ČEKAM...', W / 2, H / 2);
      return;
    }

    if (match.food) {
      ctx.fillStyle = COLORS.food;
      ctx.shadowColor = COLORS.food;
      ctx.shadowBlur = 4;
      ctx.fillRect(match.food.x * CELL + 1.5, match.food.y * CELL + 1.5, CELL - 3, CELL - 3);
      ctx.shadowBlur = 0;
    }

    for (const snake of match.snakes) {
      const color = snake.alive ? (snake.id === 0 ? COLORS.s0 : COLORS.s1) : COLORS.dead;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = snake.alive ? 3 : 0;
      snake.body.forEach((c, i) => {
        const pad = i === 0 ? 0.8 : 1.4;
        ctx.fillRect(c.x * CELL + pad, c.y * CELL + pad, CELL - pad * 2, CELL - pad * 2);
      });
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = 'rgba(122,122,168,0.9)';
    ctx.font = '4px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${match.snakes[0].score}`, 2, 6);
    if (match.snakes[1]) {
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.s1;
      ctx.fillText(`${match.snakes[1].score}`, W - 2, 6);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;

    if (authority && match && !ended && match.phase === 'play') {
      acc += dt * 1000;
      while (acc >= interval) {
        acc -= interval;
        tick();
      }
      if (online && now - lastSent >= 80) {
        lastSent = now;
        net.send({ t: 's', ...encode(match) });
      }
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
        if (msg.t === 'd' && match?.snakes[1]) setDir(match.snakes[1], msg.d);
        else if (msg.t === 'again') restart();
      } else if (msg.t === 's') {
        const prev = match;
        match = decode(msg);
        if (prev && match.phase === 'over' && prev.phase !== 'over') showGameOver();
        else if (prev && match.phase !== 'over' && prev.phase === 'over') overlay.hidden = true;
        else if (prev && match.food && prev.food && (match.food.x !== prev.food.x || match.food.y !== prev.food.y)) {
          sound.point();
        } else if (prev && match.snakes.some((s, i) => !s.alive && prev.snakes[i]?.alive)) {
          sound.miss();
        }
        // Keep local prediction of own nextDir until next tick applies
        if (lastDirSent && match.snakes[myId]?.alive) match.snakes[myId].nextDir = lastDirSent;
      }
    });
    net.onClose(opponentLeft);
    if (isHost) net.onResume(() => match && net.send({ t: 's', ...encode(match) }));
    window.addEventListener('pagehide', sayBye);
    if (isHost && match) net.send({ t: 's', ...encode(match) });
  }

  resize();
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    window.removeEventListener('keydown', onKey);
    if (online) {
      window.removeEventListener('pagehide', sayBye);
      if (!ended) sayBye();
      net.close();
    }
  };
}
