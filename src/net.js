import Peer from 'peerjs';

const PREFIX = 'gamebag-hr-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const HEARTBEAT_MS = 2000;
// Generous because mobile browsers throttle timers while the app is briefly in the background.
const PEER_TIMEOUT_MS = 15000;
const JOIN_TIMEOUT_MS = 30000;

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

export function createRoom({ onCode, onConnect, onError }) {
  let peer = null;
  let cancelled = false;
  let connected = false;
  let retries = 0;

  function open() {
    const code = randomCode();
    peer = new Peer(PREFIX + code);

    peer.on('open', () => {
      if (!cancelled) onCode(code);
    });

    peer.on('connection', (conn) => {
      if (connected || cancelled) {
        conn.on('open', () => conn.close());
        return;
      }
      connected = true;
      document.removeEventListener('visibilitychange', onVisible);
      conn.on('open', () => onConnect(wrapConnection(conn, peer)));
    });

    peer.on('disconnected', () => {
      if (!cancelled && !connected && !peer.destroyed) peer.reconnect();
    });

    peer.on('error', (err) => {
      if (cancelled || connected) return;
      if (err.type === 'unavailable-id' && retries++ < 5) {
        peer.destroy();
        open();
        return;
      }
      onError(describeError(err));
    });
  }

  // The host usually leaves for WhatsApp to send the invite; mobile browsers may drop
  // the signaling connection meanwhile, so re-register the room on return.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !cancelled && !connected && peer?.disconnected && !peer.destroyed) {
      peer.reconnect();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  open();

  return {
    cancel() {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      peer?.destroy();
    },
  };
}

export function joinRoom(code, { onConnect, onError }) {
  let cancelled = false;
  let done = false;
  const peer = new Peer();
  const timer = setTimeout(() => fail({ type: 'timeout' }), JOIN_TIMEOUT_MS);

  function fail(err) {
    if (cancelled || done) return;
    done = true;
    clearTimeout(timer);
    peer.destroy();
    onError(describeError(err));
  }

  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => {
      if (cancelled || done) return;
      done = true;
      clearTimeout(timer);
      onConnect(wrapConnection(conn, peer));
    });
    conn.on('error', fail);
  });
  peer.on('error', fail);

  return {
    cancel() {
      cancelled = true;
      clearTimeout(timer);
      if (!done) peer.destroy();
    },
  };
}
