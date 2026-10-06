import '@fontsource/press-start-2p';
import './style.css';
import QRCode from 'qrcode';
import { games, getGame } from './games/index.js';
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
      <footer class="footer">
        <button class="btn btn-small btn-ghost" id="mute"></button>
      </footer>
    </main>`,
  );

  root.querySelectorAll('.game-btn').forEach((button) => {
    onClick(button, () => show(modeScreen, getGame(button.dataset.id)));
  });

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
  const $ = render(
    root,
    `<main class="screen">
      ${game.icon.replace('pixel-icon', 'pixel-icon big')}
      <h2>${game.name}</h2>
      <nav class="menu">
        <button class="btn" id="ai">SAM PROTIV RAČUNALA</button>
        <button class="btn" id="local">DVOJE NA JEDNOM MOBITELU</button>
        <button class="btn btn-primary" id="online">ONLINE S PRIJATELJEM</button>
      </nav>
      <button class="btn btn-ghost" id="back">&lt; NATRAG</button>
    </main>`,
  );
  onClick($('#ai'), () => show(difficultyScreen, game));
  onClick($('#local'), () => startGame(game, { mode: 'local' }));
  onClick($('#online'), () => show(onlineScreen, game));
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
        <button class="btn btn-primary" data-difficulty="hard">NEPOBJEDIVO</button>
      </nav>
      <button class="btn btn-ghost" id="back">&lt; NATRAG</button>
    </main>`,
  );
  root.querySelectorAll('[data-difficulty]').forEach((button) => {
    onClick(button, () => startGame(game, { mode: 'ai', difficulty: button.dataset.difficulty }));
  });
  onClick($('#back'), () => show(modeScreen, game));
}

function onlineScreen(root, game) {
  const $ = render(
    root,
    `<main class="screen">
      <h2>ONLINE</h2>
      <p class="muted">Napravi sobu i pošalji kod prijatelju,<br>ili upiši kod koji si dobio.</p>
      <button class="btn btn-primary" id="host">NAPRAVI SOBU</button>
      <div class="divider">- ILI -</div>
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
  onClick($('#host'), () => show(hostScreen, game));
  onClick($('#back'), () => show(modeScreen, game));
}

async function shareRoom(code, link, flash) {
  const text = `Igraj sa mnom u Gamebagu! Kod sobe: ${code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Gamebag', text, url: link });
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

function hostScreen(root, game) {
  const $ = render(
    root,
    `<main class="screen">
      <h2>TVOJA SOBA</h2>
      <p class="muted">Pošalji prijatelju kod ili link,<br>ili neka skenira QR kod.</p>
      <div class="room-code" id="code">· · · · ·</div>
      <img class="qr" id="qr" alt="QR kod sobe" hidden />
      <button class="btn btn-primary" id="share" disabled>PODIJELI LINK</button>
      <p class="link" id="link"></p>
      <p class="status blink" id="status">SPAJANJE NA SERVER...</p>
      <button class="btn btn-ghost" id="back">ODUSTANI</button>
    </main>`,
  );
  const status = $('#status');
  const shareBtn = $('#share');
  let handedOff = false;
  let roomCode = null;
  let roomLink = null;

  const flash = (message) => {
    shareBtn.textContent = message;
    setTimeout(() => (shareBtn.textContent = 'PODIJELI LINK'), 2000);
  };

  const room = createRoom({
    onCode(code) {
      roomCode = code;
      roomLink = `${location.origin}${location.pathname}?soba=${code}`;
      $('#code').textContent = code;
      $('#link').textContent = roomLink;
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
      net.send({ t: 'hello', game: game.id });
      startGame(game, { mode: 'online', net, isHost: true });
    },
    onError(message) {
      status.classList.remove('blink');
      status.classList.add('status-error');
      status.textContent = message;
    },
  });

  shareBtn.addEventListener('click', () => roomCode && shareRoom(roomCode, roomLink, flash));
  onClick($('#back'), () => show(onlineScreen, game));

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
        startGame(game, { mode: 'online', net: connection, isHost: false });
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
