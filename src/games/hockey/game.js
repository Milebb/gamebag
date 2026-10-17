import { W, H, MALLET_R, PUCK_R, GOAL_W, SIDES, createMatch, step, clampMallet } from './physics.js';
import { createAi } from './ai.js';
import { sound } from '../../sound.js';

const STEP = 1 / 120;
const SEND_MS = 1000 / 30;
const COLORS = {
  bottom: '#ff2e88',
  top: '#22e4ff',
  puck: '#ffe14d',
  line: '#5a5a8a',
  table: '#12122a',
  score: 'rgba(122, 122, 168, 0.35)',
  glow: '#39ff14',
};

const NAMES = {
  ai: { bottom: 'TI', top: 'RAČUNALO' },
  local: { bottom: 'IGRAČ 1', top: 'IGRAČ 2' },
  host: { bottom: 'TI', top: 'PRIJATELJ' },
  guest: { bottom: 'PRIJATELJ', top: 'TI' },
};
const TITLES = { ai: 'PROTIV RAČUNALA', local: 'DVOJE', online: 'ONLINE' };

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * mode: 'ai' | 'local' | 'online'
 * Host (bottom) runs physics and streams snapshots; guest (top) sends mallet and sees field rotated 180°.
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
  let lastMalletSent = null;

  const targets = { bottom: null, top: null };
  const smooth = { puck: null, bottom: null };

  root.innerHTML = `
    <main class="screen pong">
      <div class="topbar">
        <button class="btn btn-small btn-ghost" data-action="exit">&lt; IZLAZ</button>
        <span class="title">AIR HOCKEY · ${TITLES[mode]}</span>
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
          ? 'SVATKO VUČE PALICU NA SVOJOJ POLOVICI'
          : flipped
            ? 'TVOJ KRAJ JE DOLJE · VUCI PALICU'
            : 'VUCI PALICU — GOL JE GORE'
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

  const toField = (event) => {
    const rect = canvas.getBoundingClientRect();
    let x = ((event.clientX - rect.left) / rect.width) * W;
    let y = ((event.clientY - rect.top) / rect.height) * H;
    if (flipped) {
      x = W - x;
      y = H - y;
    }
    return { x, y };
  };

  const pointers = new Map();

  function sideForPoint(point) {
    if (mode !== 'local') return mySide;
    return point.y > H / 2 ? 'bottom' : 'top';
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* optional */
    }
    const point = toField(event);
    const side = sideForPoint(point);
    pointers.set(event.pointerId, side);
    targets[side] = point;
  });
  canvas.addEventListener('pointermove', (event) => {
    const point = toField(event);
    let side = pointers.get(event.pointerId);
    if (!side && event.pointerType === 'mouse') side = sideForPoint(point);
    if (side) targets[side] = point;
  });
  const release = (event) => pointers.delete(event.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

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
      if (!targets[side]) continue;
      const next = clampMallet(side, targets[side].x, targets[side].y);
      match.mallets[side].x = next.x;
      match.mallets[side].y = next.y;
    }
    ai?.(match, dt);
    playEvents(step(match, dt));
  }

  function snapshot() {
    const { puck, mallets, score } = match;
    return {
      t: 's',
      p: [round2(puck.x), round2(puck.y), round2(puck.vx), round2(puck.vy)],
      m: [
        round2(mallets.bottom.x),
        round2(mallets.bottom.y),
        round2(mallets.top.x),
        round2(mallets.top.y),
      ],
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
      puck: { x: s.p[0], y: s.p[1], vx: s.p[2], vy: s.p[3] },
      mallets: {
        bottom: { x: s.m[0], y: s.m[1], px: s.m[0], py: s.m[1] },
        top: { x: s.m[2], y: s.m[3], px: s.m[2], py: s.m[3] },
      },
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
      const d = Math.hypot(match.puck.vx - prev.puck.vx, match.puck.vy - prev.puck.vy);
      if (d > 25) sound.hit();
    }
  }

  function sendMallet(now) {
    const t = targets[mySide];
    if (!t || now - lastSent < SEND_MS) return;
    const c = clampMallet(mySide, t.x, t.y);
    const key = `${c.x},${c.y}`;
    if (key === lastMalletSent) return;
    lastSent = now;
    lastMalletSent = key;
    net.send({ t: 'p', x: round2(c.x), y: round2(c.y) });
  }

  function renderState(now) {
    if (authority) return { puck: match.puck, mallets: match.mallets };

    const { puck } = match;
    let predicted = { x: puck.x, y: puck.y };
    if (match.phase === 'play') {
      const t = Math.min(0.1, (now - snapshotAt) / 1000);
      predicted = { x: puck.x + puck.vx * t, y: puck.y + puck.vy * t };
    }
    const prev = smooth.puck;
    smooth.puck =
      !prev || Math.hypot(predicted.x - prev.x, predicted.y - prev.y) > 14
        ? predicted
        : { x: prev.x + (predicted.x - prev.x) * 0.55, y: prev.y + (predicted.y - prev.y) * 0.55 };

    if (!smooth.bottom) smooth.bottom = { ...match.mallets.bottom };
    smooth.bottom.x += (match.mallets.bottom.x - smooth.bottom.x) * 0.5;
    smooth.bottom.y += (match.mallets.bottom.y - smooth.bottom.y) * 0.5;

    const top = targets.top
      ? clampMallet('top', targets.top.x, targets.top.y)
      : match.mallets.top;

    return {
      puck: smooth.puck,
      mallets: { bottom: smooth.bottom, top },
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
    ctx.fillStyle = COLORS.table;
    ctx.fillRect(0, 0, W, H);

    // Neon rink
    ctx.strokeStyle = COLORS.glow;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2, H / 2);
    ctx.lineTo(W - 2, H / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Goals
    const gx = (W - GOAL_W) / 2;
    ctx.fillStyle = '#0b0b1a';
    ctx.fillRect(gx, 0, GOAL_W, 3);
    ctx.fillRect(gx, H - 3, GOAL_W, 3);
    ctx.fillStyle = COLORS.glow;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(gx, 0, GOAL_W, 1.5);
    ctx.fillRect(gx, H - 1.5, GOAL_W, 1.5);
    ctx.globalAlpha = 1;

    if (!match) {
      drawText('ČEKAM...', W / 2, H / 2, 5, COLORS.puck);
      return;
    }

    const { puck, mallets } = renderState(now);
    const vx = (x) => (flipped ? W - x : x);
    const vy = (y) => (flipped ? H - y : y);
    const near = flipped ? 'top' : 'bottom';
    const far = flipped ? 'bottom' : 'top';

    drawText(String(match.score[near]), W / 2, H / 2 + 18, 14, COLORS.score);
    drawText(String(match.score[far]), W / 2, H / 2 - 18, 14, COLORS.score, mode === 'local');

    ctx.shadowBlur = 5;
    for (const side of SIDES) {
      const m = mallets[side];
      ctx.fillStyle = ctx.shadowColor = COLORS[side];
      ctx.beginPath();
      ctx.arc(vx(m.x), vy(m.y), MALLET_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0b1a';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(vx(m.x), vy(m.y), MALLET_R * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 5;
    }

    const showPuck = match.phase === 'play' || (match.phase === 'serve' && Math.floor(now / 150) % 2 === 0);
    if (showPuck) {
      ctx.fillStyle = ctx.shadowColor = COLORS.puck;
      ctx.beginPath();
      ctx.arc(vx(puck.x), vy(puck.y), PUCK_R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (match.phase === 'countdown') {
      drawText(String(Math.max(1, Math.ceil(match.timer))), W / 2, H / 2 + 0.5, 16, COLORS.puck);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;

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
      sendMallet(now);
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
        if (msg.t === 'p' && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
          targets.top = clampMallet('top', msg.x, msg.y);
        } else if (msg.t === 'again') restart();
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
    if (online) {
      window.removeEventListener('pagehide', sayBye);
      if (!ended) sayBye();
      net.close();
    }
  };
}
