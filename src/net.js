import Peer from 'peerjs';

const PREFIX = 'gamebag-hr-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const HEARTBEAT_MS = 2000;
// Generous because mobile browsers throttle timers while the app is briefly in the background.
const PEER_TIMEOUT_MS = 15000;
const HOST_WAIT_MS = 60000;
const JOIN_TIMEOUT_MS = HOST_WAIT_MS + 15000;
const JOIN_RETRY_MS = 3000;
const KEPT_ATTEMPTS = 2;
const KEEPALIVE_MS = 3000;
const STUCK_MS = 15000;

export function normalizeCode(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

export function isValidCode(code) {
  return code.length === CODE_LENGTH && [...code].every((ch) => ALPHABET.includes(ch));
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

function describeError(err) {
  switch (err?.type) {
    case 'peer-unavailable':
      return 'Soba nije pronađena. Provjeri kod.';
    case 'host-missing':
      return 'Prijatelj nije u sobi. Neka otvori Gamebag na ekranu s pozivnicom, pa pokušaj ponovno.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Nema veze sa serverom. Provjeri internet.';
    case 'browser-incompatible':
      return 'Ovaj preglednik ne podržava online igru.';
    case 'timeout':
      return 'Spajanje traje predugo. Pokušaj ponovno.';
    default:
      return 'Greška u spajanju. Pokušaj ponovno.';
  }
}

/**
 * Wraps a PeerJS data connection in a tiny message channel:
 * send(msg), setHandler(fn), onClose(fn), close().
 * Messages that arrive before a handler is set are queued.
 */
function wrapConnection(conn, peer) {
  let handler = null;
  let closeHandler = null;
  let closed = false;
  let lastSeen = Date.now();
  const queue = [];

  const deliver = () => {
    while (handler && queue.length) handler(queue.shift());
  };

  const send = (msg) => {
    if (!closed && conn.open) conn.send(msg);
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    closeHandler?.();
  };

  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > PEER_TIMEOUT_MS) finish();
    else send({ t: 'ping' });
  }, HEARTBEAT_MS);

  conn.on('data', (msg) => {
    lastSeen = Date.now();
    if (!msg || msg.t === 'ping') return;
    queue.push(msg);
    deliver();
  });
  conn.on('close', finish);
  conn.on('error', finish);

  return {
    send,
    setHandler(fn) {
      handler = fn;
      deliver();
    },
    onClose(fn) {
      closeHandler = fn;
      if (closed) fn();
    },
    close() {
      closed = true;
      clearInterval(heartbeat);
      // Give a final message (e.g. "bye") a moment to flush.
      setTimeout(() => {
        conn.close();
        peer.destroy();
      }, 300);
    },
  };
}

export function createRoom({ onCode, onStatus, onConnect, onError }) {
  let peer = null;
  let code = null;
  let cancelled = false;
  let connected = false;
  let retries = 0;
  let pendingSince = 0;

  const active = () => !cancelled && !connected;

  function open(id) {
    const current = new Peer(PREFIX + id);
    peer = current;
    pendingSince = Date.now();

    current.on('open', () => {
      if (current !== peer || !active()) return;
      if (code) return onStatus('waiting');
      code = id;
      onCode(code);
    });

    // Offers queued on the server while the room was gone arrive stale and never open,
    // so the first connection that actually opens wins.
    current.on('connection', (conn) => {
      conn.on('open', () => {
        if (current !== peer || !active()) return conn.close();
        connected = true;
        stopWatching();
        onConnect(wrapConnection(conn, current));
      });
    });

    current.on('disconnected', () => {
      if (current === peer && active() && code) onStatus('reconnecting');
    });

    current.on('error', (err) => {
      if (current !== peer || !active()) return;
      if (code) return onStatus('reconnecting');
      if (err.type === 'unavailable-id' && retries++ < 5) {
        current.destroy();
        open(randomCode());
        return;
      }
      onError(describeError(err));
    });
  }

  // The host usually leaves for WhatsApp to send the invite and mobile browsers may drop
  // the signaling connection meanwhile; the room must come back under the same code,
  // because the invite link has already been sent.
  function ensureRegistered() {
    if (!active() || !code) return;
    if (peer.destroyed) {
      open(code);
    } else if (peer.disconnected) {
      pendingSince = Date.now();
      peer.reconnect();
    } else if (!peer.open && Date.now() - pendingSince > STUCK_MS) {
      peer.destroy();
      open(code);
    }
  }

  const onVisible = () => document.visibilityState === 'visible' && ensureRegistered();
  const keepAlive = setInterval(ensureRegistered, KEEPALIVE_MS);
  document.addEventListener('visibilitychange', onVisible);

  function stopWatching() {
    clearInterval(keepAlive);
    document.removeEventListener('visibilitychange', onVisible);
  }

  open(randomCode());

  return {
    cancel() {
      cancelled = true;
      stopWatching();
      peer?.destroy();
    },
  };
}

export function joinRoom(code, { onWaiting, onConnect, onError }) {
  let cancelled = false;
  let done = false;
  let attempts = [];
  let knocker = null;
  const deadline = Date.now() + HOST_WAIT_MS;
  const peer = new Peer();
  const timer = setTimeout(() => fail({ type: 'timeout' }), JOIN_TIMEOUT_MS);

  const answered = () => attempts.some((conn) => conn.peerConnection?.remoteDescription);

  function stop() {
    done = true;
    clearTimeout(timer);
    clearInterval(knocker);
  }

  function fail(err) {
    if (cancelled || done) return;
    stop();
    peer.destroy();
    onError(describeError(err));
  }

  function connect() {
    if (cancelled || done) return;
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    attempts.push(conn);
    if (attempts.length > KEPT_ATTEMPTS) attempts.shift().close();
    conn.on('open', () => {
      if (cancelled || done) return;
      stop();
      attempts.filter((other) => other !== conn).forEach((other) => other.close());
      attempts = [];
      onConnect(wrapConnection(conn, peer));
    });
    conn.on('error', (err) => attempts.includes(conn) && fail(err));
  }

  // The host may still be in WhatsApp with the room temporarily gone, so keep knocking
  // until it answers; the server reports only the first knock on a missing room.
  function knockAgain() {
    if (answered()) return;
    if (Date.now() >= deadline) return fail({ type: 'host-missing' });
    onWaiting();
    connect();
  }

  peer.on('open', () => {
    if (knocker) return;
    connect();
    knocker = setInterval(knockAgain, JOIN_RETRY_MS);
  });
  peer.on('error', (err) => (err.type === 'peer-unavailable' ? onWaiting() : fail(err)));
  return {
    cancel() {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(knocker);
      if (!done) peer.destroy();
    },
  };
}
