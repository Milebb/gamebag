import {
  W,
  H,
  ROWS,
  COLS,
  ALIEN_W,
  SHIP_Y,
  SHIP_W,
  SHIP_H,
  COMMANDER_COOLDOWN,
  BULLET_SPEED,
  BOMB_SPEED,
  createGame,
  step,
  commanderFire,
  alienRect,
  clampShip,
  encode,
  decode,
} from './sim.js';
import { ALIENS, ROW_TYPE, SHIP, EXPLOSION, sprite } from './sprites.js';
import { sound } from '../../sound.js';

const STEP = 1 / 120;
const SNAPSHOT_MS = 1000 / 20;
const INPUT_MS = 1000 / 30;
const KEY_SPEED = 90;
const EXPLOSION_TIME = 0.3;
const ROW_COLORS = ['#ffe14d', '#39ff14', '#39ff14', '#b14dff', '#b14dff'];
const SHIP_COLORS = ['#ff2e88', '#22e4ff'];
const TITLES = { ai: 'SAM', local: 'ZAJEDNO', coop: 'ONLINE ZAJEDNO', versus: 'ONLINE DVOBOJ' };

function readBest(key) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Private mode: the record just won't persist.
  }
}

/**
 * mode: 'ai' (solo) | 'local' (two ships, one phone) | 'online'
 * variant (online): 'coop' (two ships) | 'versus' (one player flies the ship, the other commands the aliens).
 * The host runs the simulation and streams snapshots; the guest sends its input.
 */
export function start(root, { mode, variant = 'coop', difficulty = 'medium', net = null, isHost = false, onExit }) {
  const online = mode === 'online';
  const versus = online && variant === 'versus';
  const authority = !online || isHost;
  const shipCount = mode === 'ai' || versus ? 1 : 2;
  const me = online && !isHost ? 'guest' : 'host';
  const bestKey = `gamebag-invaders-best-${shipCount}`;

  let shipOwner = 'host';
  const myRole = () => (versus && shipOwner !== me ? 'aliens' : 'ship');
  const myShip = () => (online && !versus && !isHost ? 1 : 0);
  const newGame = () => createGame({ ships: shipCount, difficulty, versus });

  let game = authority ? newGame() : null;
  let snapshotAt = 0;
  let ended = false;
  let raf = 0;
  let lastFrame = 0;
  let accumulator = 0;
  let lastSnapshot = 0;
  let lastInput = 0;
  let lastInputX = null;

  const targets = Array(shipCount).fill(null);
  const effects = [];
  const keys = new Set();
  const pointers = new Map();

  root.innerHTML = `
    <main class="screen pong invaders">
      <div class="topbar">
        <button class="btn btn-small btn-ghost" data-action="exit">&lt; IZLAZ</button>
        <span class="title">SVEMIRCI · ${TITLES[online ? variant : mode]}</span>
      </div>
      <div class="pong-wrap">
        <canvas class="pong-canvas"></canvas>
        <div class="pong-overlay" hidden>
          <p class="pong-result"></p>
          <button class="btn btn-primary" data-action="again">NOVA IGRA</button>
          <button class="btn btn-ghost" data-action="exit">IZBORNIK</button>
        </div>
      </div>
      <p class="hint"></p>
    </main>`;

  const screen = root.querySelector('.screen');
  const wrap = root.querySelector('.pong-wrap');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const overlay = root.querySelector('.pong-overlay');
  const resultEl = root.querySelector('.pong-result');
  const againBtn = root.querySelector('[data-action="again"]');
  const hintEl = root.querySelector('.hint');

  screen.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'exit') onExit();
    if (action === 'again') {
      sound.click();
      restart();
    }
  });

  function updateHint() {
    if (mode === 'local') hintEl.textContent = 'SVAKI BROD PRATI SVOJ PRST';
    else if (myRole() === 'aliens') hintEl.textContent = 'DODIRNI IZNAD STUPCA DA SVEMIRCI PUCAJU';
    else hintEl.textContent = 'VUCI PRSTOM - BROD PUCA SAM';
  }

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
    ctx.imageSmoothingEnabled = false;
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(wrap);

  // --- Input ---

  function fieldX(event) {
    const rect = canvas.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * W;
  }

  function shipForPointer(x) {
    if (mode !== 'local' || !game) return myShip();
    const taken = new Set(pointers.values());
    const byDistance = [0, 1].sort((a, b) => Math.abs(game.ships[a].x - x) - Math.abs(game.ships[b].x - x));
    return byDistance.find((i) => !taken.has(i) && game.ships[i].lives > 0) ?? byDistance[0];
  }

  function fire(x) {
    if (!authority) return net.send({ t: 'fire', x });
    if (commanderFire(game, x)) sound.fire();
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const x = fieldX(event);
    if (myRole() === 'aliens') return fire(x);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is only an improvement (keeps tracking outside the canvas).
    }
    const ship = shipForPointer(x);
    pointers.set(event.pointerId, ship);
    targets[ship] = x;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (myRole() === 'aliens') return;
    let ship = pointers.get(event.pointerId);
    if (ship === undefined && event.pointerType === 'mouse' && mode !== 'local') ship = myShip();
    if (ship !== undefined) targets[ship] = fieldX(event);
  });
  const releasePointer = (event) => pointers.delete(event.pointerId);
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  const onKeyDown = (event) => keys.add(event.key);
  const onKeyUp = (event) => keys.delete(event.key);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function applyKeys(dt) {
    if (!game || myRole() !== 'ship') return;
    const move = (ship, left, right) => {
      const dir = (keys.has(right) ? 1 : 0) - (keys.has(left) ? 1 : 0);
      if (!dir) return;
      const current = targets[ship] ?? game.ships[ship].x;
      targets[ship] = clampShip(current + dir * KEY_SPEED * dt);
    };
    move(myShip(), 'ArrowLeft', 'ArrowRight');
    if (mode === 'local') move(1, 'a', 'd');
  }

  // --- Game flow ---

  function restart() {
    if (!authority) return net.send({ t: 'again' });
    if (game.phase !== 'over' || ended) return;
    if (versus) shipOwner = shipOwner === 'host' ? 'guest' : 'host';
    game = newGame();
    targets.fill(null);
    overlay.hidden = true;
    updateHint();
  }

  function showGameOver() {
    let text;
    if (versus) {
      const won = game.winner === myRole();
      text = `${won ? 'POBJEDA!' : 'PORAZ!'}\n${game.winner === 'ship' ? 'NEBO JE OČIŠĆENO' : 'SVEMIRCI SU SLETJELI'}`;
      if (won) sound.win();
      else sound.lose();
      againBtn.textContent = 'NOVA IGRA · ZAMJENA';
    } else {
      const best = readBest(bestKey);
      const record = game.score > best;
      if (record) saveBest(bestKey, game.score);
      text = `KRAJ IGRE\nBODOVI: ${game.score}\n${record ? 'NOVI REKORD!' : `REKORD: ${best}`}`;
      if (record) sound.win();
      else sound.lose();
    }
    resultEl.textContent = text;
    overlay.hidden = false;
  }

  function explode(state, row, col) {
    const rect = alienRect(state, row, col);
    effects.push({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, color: ROW_COLORS[row], age: 0 });
  }

  function isMine(shipIndex) {
    return mode === 'local' || (myRole() === 'ship' && shipIndex === myShip());
  }

  function playEvents(events, state) {
    for (const event of events) {
      if (event.type === 'kill') {
        explode(state, event.row, event.col);
        sound.kill();
      } else if (event.type === 'shipHit') {
        sound.shipHit();
        if (isMine(event.ship)) navigator.vibrate?.(150);
      } else if (event.type === 'march') sound.march();
      else if (event.type === 'wave') sound.wave();
      else if (event.type === 'over') showGameOver();
    }
  }

  function tick(dt) {
    game.ships.forEach((ship, i) => {
      if (targets[i] !== null) ship.target = targets[i];
    });
    playEvents(step(game, dt), game);
  }

  function receiveSnapshot(s) {
    const prev = game;
    game = decode(s);
    snapshotAt = performance.now();
    if (s.own && s.own !== shipOwner) {
      shipOwner = s.own;
      targets.fill(null);
    }
    updateHint();
    if (!prev) return;

    const events = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (prev.alive[row][col] && !game.alive[row][col] && game.wave === prev.wave) events.push({ type: 'kill', row, col });
      }
    }
    game.ships.forEach((ship, i) => {
      if (prev.ships[i] && ship.lives < prev.ships[i].lives) events.push({ type: 'shipHit', ship: i });
    });
    if (game.anim !== prev.anim) events.push({ type: 'march' });
    if (game.wave > prev.wave) events.push({ type: 'wave' });
    if (game.phase === 'over' && prev.phase !== 'over') events.push({ type: 'over' });
    if (game.phase !== 'over' && prev.phase === 'over') overlay.hidden = true;
    playEvents(events, prev);
  }

  function sendInput(now) {
    if (myRole() !== 'ship') return;
    const x = targets[myShip()];
    if (x === null || x === lastInputX || now - lastInput < INPUT_MS) return;
    lastInput = now;
    lastInputX = x;
    net.send({ t: 'i', x: Math.round(clampShip(x) * 100) / 100 });
  }

  // --- Rendering ---

  /** The state to draw. The guest extrapolates moving things since the last snapshot. */
  function viewState(now) {
    const mine = myShip();
    const ownTarget = myRole() === 'ship' ? targets[mine] : null;
    if (authority) return game;

    const t = game.phase === 'play' ? Math.min(0.1, (now - snapshotAt) / 1000) : 0;
    return {
      ...game,
      commanderCooldown: Math.max(0, game.commanderCooldown - t),
      fleet: { ...game.fleet, x: game.fleet.x + game.fleet.dir * game.fleet.speed * t },
      bullets: game.bullets.map((b) => ({ ...b, y: b.y - BULLET_SPEED * t })),
      bombs: game.bombs.map((b) => ({ ...b, y: b.y + BOMB_SPEED * t })),
      ships: game.ships.map((ship, i) =>
        i === mine && ownTarget !== null && ship.lives > 0 ? { ...ship, x: clampShip(ownTarget) } : ship,
      ),
    };
  }

  function drawText(text, x, y, size, color, align = 'center') {
    ctx.font = `${size}px "Press Start 2P", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawSprite(bitmap, color, cx, cy, width) {
    const pixel = width / bitmap[0].length;
    const height = bitmap.length * pixel;
    ctx.drawImage(sprite(bitmap, color), cx - width / 2, cy - height / 2, width, height);
  }

  function draw(now, dt) {
    ctx.fillStyle = '#0b0b1a';
    ctx.fillRect(0, 0, W, H);

    if (!game) {
      drawText('ČEKAM...', W / 2, H / 2, 5, '#ffe14d');
      return;
    }
    const state = viewState(now);

    drawText(String(state.score).padStart(5, '0'), 2, 5, 3.5, '#f2f2ff', 'left');
    drawText(`VAL ${state.wave}`, W / 2, 5, 3.5, '#7a7aa8');
    state.ships.forEach((ship, i) => {
      for (let life = 0; life < ship.lives; life++) {
        drawSprite(SHIP, SHIP_COLORS[i], W - 4 - life * 6, 4 + i * 4, 5);
      }
    });

    ctx.fillStyle = '#5a5a8a';
    ctx.fillRect(0, SHIP_Y + SHIP_H / 2 + 3, W, 0.5);

    for (let row = 0; row < ROWS; row++) {
      const bitmap = ALIENS[ROW_TYPE[row]][state.anim];
      for (let col = 0; col < COLS; col++) {
        if (!state.alive[row][col]) continue;
        const rect = alienRect(state, row, col);
        drawSprite(bitmap, ROW_COLORS[row], rect.x + rect.w / 2, rect.y + rect.h / 2, (bitmap[0].length * ALIEN_W) / 12);
      }
    }

    state.ships.forEach((ship, i) => {
      if (ship.lives <= 0) return;
      if (ship.inv > 0 && Math.floor(now / 100) % 2) return;
      drawSprite(SHIP, SHIP_COLORS[i], ship.x, SHIP_Y, SHIP_W);
    });

    ctx.fillStyle = '#f2f2ff';
    for (const bullet of state.bullets) ctx.fillRect(bullet.x - 0.4, bullet.y - 1.5, 0.8, 3);
    ctx.fillStyle = '#ff6b3d';
    for (const bomb of state.bombs) {
      const wiggle = Math.floor(bomb.y / 2) % 2 ? 0.4 : -0.4;
      ctx.fillRect(bomb.x - 0.6 + wiggle, bomb.y - 1.5, 1.2, 3);
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i];
      effect.age += dt;
      if (effect.age > EXPLOSION_TIME) effects.splice(i, 1);
      else drawSprite(EXPLOSION, effect.color, effect.x, effect.y, 7);
    }

    if (myRole() === 'aliens' && state.phase === 'play') {
      const ready = state.commanderCooldown <= 0;
      ctx.fillStyle = ready ? '#ffe14d' : '#5a5a8a';
      ctx.fillRect(0, H - 2, W * (1 - state.commanderCooldown / COMMANDER_COOLDOWN), 2);
    }

    if (state.phase === 'countdown' || state.phase === 'wave') {
      drawText(`VAL ${state.wave}`, W / 2, H / 2 + 8, 8, '#ffe14d');
      if (versus) drawText(myRole() === 'ship' ? 'TI SI BROD' : 'TI SI SVEMIRAC', W / 2, H / 2 + 20, 4, '#22e4ff');
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
      if (online && !ended && now - lastSnapshot >= SNAPSHOT_MS) {
        lastSnapshot = now;
        net.send({ ...encode(game), own: shipOwner });
      }
    } else if (!ended && game) {
      sendInput(now);
    }

    draw(now, dt);
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
        const guestFlies = !versus || shipOwner === 'guest';
        if (msg.t === 'i' && guestFlies && Number.isFinite(msg.x)) targets[versus ? 0 : 1] = clampShip(msg.x);
        else if (msg.t === 'fire' && versus && shipOwner === 'host' && Number.isFinite(msg.x)) {
          if (commanderFire(game, msg.x)) sound.fire();
        } else if (msg.t === 'again') restart();
      } else if (msg.t === 's') {
        receiveSnapshot(msg);
      }
    });
    net.onClose(opponentLeft);
    window.addEventListener('pagehide', sayBye);
  }

  updateHint();
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
