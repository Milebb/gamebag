import '@fontsource/press-start-2p';
import './style.css';
import QRCode from 'qrcode';
import { games, getGame, DEFAULT_MODES } from './games/index.js';
import { createRoom, joinRoom, normalizeCode, isValidCode } from './net.js';
import { sound, isMuted, setMuted } from './sound.js';

const app = document.getElementById('app');
let cleanup = null;

function show(screen, ...args) {
  cleanup?.();
  cleanup = null;
  app.innerHTML = '';
  cleanup = screen(app, ...args) ?? null;
  window.scrollTo(0, 0);
}

function render(root, html) {
  root.innerHTML = html;
  return (selector) => root.querySelector(selector);
}

function onClick(element, handler) {
  element.addEventListener('click', () => {
    sound.click();
    handler();
  });
}

function startGame(game, options) {
  const back = options.mode === 'online' ? () => show(homeScreen) : () => show(modeScreen, game);
  show((root) => game.start(root, { ...options, onExit: back }));
}

function homeScreen(root) {
  const $ = render(
    root,
    `<main class="screen home">
      <header class="logo">
        <h1>GAME<span>BAG</span></h1>
        <p class="tagline">KLASIČNE IGRE ZA DVOJE</p>
      </header>
      <nav class="menu">
        ${games
          .map(
            (game) => `
          <button class="btn game-btn" data-id="${game.id}" ${game.available ? '' : 'disabled'}>
            ${game.icon}
            <span class="game-name">${game.name}</span>
            ${game.available ? '' : '<span class="soon">USKORO</span>'}
          </button>`,
          )
          .join('')}
      </nav>
      <button class="btn btn-ghost" id="join">IMAM KOD OD PRIJATELJA</button>
      <footer class="footer">
        <button class="btn btn-small btn-ghost" id="mute"></button>
      </footer>
    </main>`,
  );

  root.querySelectorAll('.game-btn').forEach((button) => {
    onClick(button, () => show(modeScreen, getGame(button.dataset.id)));
  });
  onClick($('#join'), () => show(codeScreen));

  const mute = $('#mute');
  const label = () => (mute.textContent = isMuted() ? 'ZVUK: ISKLJUČEN' : 'ZVUK: UKLJUČEN');
  label();
  mute.addEventListener('click', () => {
    setMuted(!isMuted());
    label();
    sound.click();
  });
}

function modeScreen(root, game) {
  const modes = game.modes ?? DEFAULT_MODES;
  const $ = render(
    root,
    `<main class="screen">
      ${game.icon.replace('pixel-icon', 'pixel-icon big')}
      <h2>${game.name}</h2>
      <nav class="menu">
        ${modes
          .map(
            (option, i) =>
              `<button class="btn ${option.mode === 'online' ? 'btn-primary' : ''}" data-mode="${i}">${option.label}</button>`,
          )
          .join('')}
      </nav>
      <button class="btn btn-ghost" id="back">&lt; NATRAG</button>
    </main>`,
  );
  root.querySelectorAll('[data-mode]').forEach((button) => {
    const option = modes[Number(button.dataset.mode)];
    onClick(button, () => {
      if (option.mode === 'ai') show(difficultyScreen, game);
      else if (option.mode === 'local') startGame(game, { mode: 'local' });
      else show(hostScreen, game, option);
    });
  });
  onClick($('#back'), () => show(homeScreen));
}

function difficultyScreen(root, game) {
  const $ = render(
    root,
    `<main class="screen">
      <h2>TEŽINA</h2>
      <nav class="menu">
        <button class="btn" data-difficulty="easy">LAKO</button>
        <button class="btn" data-difficulty="medium">SREDNJE</button>
        <button class="btn btn-primary" data-difficulty="hard">${game.hardLabel}</button>
      </nav>
      <button class="btn btn-ghost" id="back">&lt; NATRAG</button>
    </main>`,
  );
  root.querySelectorAll('[data-difficulty]').forEach((button) => {
    onClick(button, () => startGame(game, { mode: 'ai', difficulty: button.dataset.difficulty }));
  });
  onClick($('#back'), () => show(modeScreen, game));
}

function codeScreen(root) {
  const $ = render(
    root,
    `<main class="screen">
      <h2>PRIDRUŽI SE</h2>
      <p class="muted">Upiši kod sobe koji ti je<br>prijatelj poslao.</p>
      <form class="join-form" id="join">
        <label for="code">KOD SOBE</label>
        <input id="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE" />
        <button class="btn" type="submit">PRIDRUŽI SE</button>
      </form>
      <p class="error" id="error"></p>
      <button class="btn btn-ghost" id="back">&lt; NATRAG</button>
    </main>`,
  );
  const input = $('#code');
  input.addEventListener('input', () => (input.value = normalizeCode(input.value)));
  $('#join').addEventListener('submit', (event) => {
    event.preventDefault();
    sound.click();
    const code = normalizeCode(input.value);
    if (!isValidCode(code)) {
      $('#error').textContent = 'Kod ima 5 znakova (slova i brojke).';
      return;
    }
    show(joinScreen, code);
  });
  onClick($('#back'), () => show(homeScreen));
  input.focus();
}

async function shareRoom(text, link, flash) {
  if (navigator.share) {
    try {
      // Some apps glue a separate `url` onto the text without a space, breaking the link.
      await navigator.share({ text: `${text}\n${link}` });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${link}`);
    flash('LINK KOPIRAN!');
  } catch {
    flash('KOPIRAJ LINK ISPOD');
  }
}

function hostScreen(root, game, option) {
  const { variant } = option;
  const $ = render(
    root,
    `<main class="screen">
      <h2>POZOVI PRIJATELJA</h2>
      <p class="muted">${game.name}${option.subtitle ? ` · ${option.subtitle}` : ''}</p>
      <a class="btn btn-whatsapp" id="whatsapp" target="_blank" rel="noopener" aria-disabled="true">POŠALJI NA WHATSAPP</a>
      <button class="btn" id="share" disabled>POŠALJI DRUGAČIJE</button>
      <p class="status blink" id="status">PRIPREMAM SOBU...</p>
      <p class="muted">Nakon slanja vrati se ovdje.<br>Igra kreće čim prijatelj klikne link.</p>
      <div class="divider">- ILI NEKA SKENIRA / UPIŠE KOD -</div>
      <img class="qr" id="qr" alt="QR kod sobe" hidden />
      <div class="room-code" id="code">· · · · ·</div>
      <button class="btn btn-ghost" id="back">ODUSTANI</button>
    </main>`,
  );
  const status = $('#status');
  const shareBtn = $('#share');
  const whatsapp = $('#whatsapp');
  let handedOff = false;
  let invite = null;
  let roomLink = null;

  const flash = (message) => {
    shareBtn.textContent = message;
    setTimeout(() => (shareBtn.textContent = 'POŠALJI DRUGAČIJE'), 2000);
  };

  const room = createRoom({
    onCode(code) {
      roomLink = `${location.origin}${location.pathname}?soba=${code}`;
      invite = `${option.invite ?? game.invite} Klikni link i odmah igramo:`;
      $('#code').textContent = code;
      whatsapp.href = `https://wa.me/?text=${encodeURIComponent(`${invite}\n${roomLink}`)}`;
      whatsapp.removeAttribute('aria-disabled');
      shareBtn.disabled = false;
      status.textContent = 'ČEKAM PRIJATELJA...';
      QRCode.toDataURL(roomLink, { margin: 1, width: 360 }).then((url) => {
        const qr = $('#qr');
        if (!qr) return;
        qr.src = url;
        qr.hidden = false;
      });
    },
    onConnect(net) {
      handedOff = true;
      sound.join();
      net.send({ t: 'hello', game: game.id, variant });
      startGame(game, { mode: 'online', variant, net, isHost: true });
    },
    onError(message) {
      status.classList.remove('blink');
      status.classList.add('status-error');
      status.textContent = message;
    },
  });

  whatsapp.addEventListener('click', (event) => {
    if (!roomLink) event.preventDefault();
    else sound.click();
  });
  shareBtn.addEventListener('click', () => roomLink && shareRoom(invite, roomLink, flash));
  onClick($('#back'), () => show(modeScreen, game));

  return () => {
    if (!handedOff) room.cancel();
  };
}

function joinScreen(root, code) {
  const $ = render(
    root,
    `<main class="screen">
      <h2>PRIDRUŽIVANJE</h2>
      <div class="room-code">${code}</div>
      <p class="status blink" id="status">SPAJAM SE...</p>
      <button class="btn btn-ghost" id="back">ODUSTANI</button>
    </main>`,
  );
  const status = $('#status');
  let net = null;
  let started = false;

  const showError = (message) => {
    status.classList.remove('blink');
    status.classList.add('status-error');
    status.textContent = message;
    $('#back').textContent = 'NATRAG';
  };

  const attempt = joinRoom(code, {
    onConnect(connection) {
      net = connection;
      status.textContent = 'SPOJENO! ČEKAM DOMAĆINA...';
      connection.onClose(() => !started && showError('Veza je prekinuta.'));
      connection.setHandler((msg) => {
        if (msg.t !== 'hello') return;
        const game = getGame(msg.game);
        if (!game) return showError('Prijatelj igra igru koju nemaš. Osvježi stranicu.');
        started = true;
        sound.join();
        startGame(game, { mode: 'online', variant: msg.variant, net: connection, isHost: false });
      });
    },
    onError: showError,
  });

  onClick($('#back'), () => show(homeScreen));

  return () => {
    attempt.cancel();
    if (net && !started) net.close();
  };
}

const params = new URLSearchParams(location.search);
const roomFromLink = normalizeCode(params.get('soba'));
if (params.has('soba')) history.replaceState(null, '', location.pathname);

if (isValidCode(roomFromLink)) show(joinScreen, roomFromLink);
else show(homeScreen);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
