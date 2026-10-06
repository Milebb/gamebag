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
const ICE_OPEN_MS = 15000;

// PeerJS's bundled TURN hosts no longer exist and no free public TURN relay works without an
// account, so phones behind carrier-grade NAT can only connect once credentials from a TURN
// provider (e.g. Metered, whose relay host is preset here) are filled in.
const TURN = { host: 'global.relay.metered.ca', username: '', credential: '' };

export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478', 'stun:stun1.l.google.com:19302'] },
  ...(TURN.username
    ? [
        {
          urls: [
            `turn:${TURN.host}:80`,
            `turn:${TURN.host}:80?transport=tcp`,
            `turn:${TURN.host}:443`,
            `turns:${TURN.host}:443?transport=tcp`,
          ],
          username: TURN.username,
          credential: TURN.credential,
        },
      ]
    : []),
];

const PEER_OPTIONS = { config: { iceServers: ICE_SERVERS } };

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
    case 'closed':
      return 'Veza je prekinuta. Pokušaj ponovno.';
    case 'ice-failed':
    case 'negotiation-failed':
      return 'Ne mogu se spojiti s prijateljem. Mreža blokira izravnu vezu. Pokušajte oboje biti na istom Wi-Fi-ju.';
    default:
      return 'Greška u spajanju. Pokušaj ponovno.';
  }
}

async function describeRoute(pc) {
  try {
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
    });
    if (!pair) {
      stats.forEach((s) => {
        if (!pair && s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
      });
    }
    if (!pair) return '';
    const local = stats.get(pair.localCandidateId)?.candidateType;
    const remote = stats.get(pair.remoteCandidateId)?.candidateType;
    const relayed = local === 'relay' || remote === 'relay';
    return `veza: ${local}-${remote}${relayed ? ' (TURN)' : ''}`;
  } catch {
    return '';
  }
}

/**
 * Follows the ICE negotiation of a not-yet-open connection: reports progress as a short
 * diagnostic line and calls onFail if ICE fails or the channel doesn't open within
 * ICE_OPEN_MS of the offer/answer exchange.
 */
function watchIce(conn, { onDiag, onFail, onAnswer }) {
  const pc = conn.peerConnection;
  if (!pc) return;
  const states = [];
  const types = new Set();
  let route = '';
  let timer = null;
  let stopped = false;

  const report = () => {
    const parts = [`ICE: ${states.join(' → ') || 'čekam'}`];
    if (route) parts.push(route);
    parts.push(`kandidati: ${[...types].join(',') || '-'}`);
    if (!TURN.username) parts.push('bez TURN-a');
    onDiag?.(parts.join(' · '));
  };
  const record = (state) => {
    if (states[states.length - 1] === state) return;
    states.push(state);
    report();
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  const fail = () => {
    if (stopped) return;
    stop();
    onFail();
  };
  const startTimer = () => {
    if (timer || stopped) return;
    onAnswer?.();
    report();
    timer = setTimeout(() => {
      record('isteklo');
      fail();
    }, ICE_OPEN_MS);
  };

  pc.addEventListener('icecandidate', (event) => {
    const type = event.candidate?.type || event.candidate?.candidate.match(/ typ (\w+)/)?.[1];
    if (type && !types.has(type)) {
      types.add(type);
      report();
    }
  });
  pc.addEventListener('signalingstatechange', () => pc.remoteDescription && startTimer());
  pc.addEventListener('iceconnectionstatechange', () => {
    const state = pc.iceConnectionState;
    if (state === 'closed') return;
    record(state);
    if (state === 'failed') fail();
    if (state === 'connected' || state === 'completed') {
      describeRoute(pc).then((text) => {
        route = text;
        report();
      });
    }
  });
  conn.on('open', stop);
  // PeerJS reports ICE failure as a connection error and closes the peer connection right away.
  conn.on('error', () => {
    if (pc.iceConnectionState === 'failed') record('failed');
    fail();
  });
  if (pc.remoteDescription) startTimer();
}

/**
 * Wraps a PeerJS data connection in a tiny message channel:
 * send(msg), setHandler(fn), onClose(fn), close().
 * Messages that arrive before a handler is set are queued.
 */
function wrapConnection(conn, peer, queue = []) {
  let handler = null;
  let closeHandler = null;
  let closed = false;
  let lastSeen = Date.now();

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
    if (!msg || msg.t === 'ping' || msg.t === 'pick') return;
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

export function createRoom({ onCode, onStatus, onConnect, onError, onDiag }) {
  let peer = null;
  let code = null;
  let cancelled = false;
  let connected = false;
  let retries = 0;
  let pendingSince = 0;
  const pending = new Set();

  const active = () => !cancelled && !connected;

  function open(id) {
    const current = new Peer(PREFIX + id, PEER_OPTIONS);
    peer = current;
    pendingSince = Date.now();

    current.on('open', () => {
      if (current !== peer || !active()) return;
      if (code) return onStatus('waiting');
      code = id;
      onCode(code);
    });

    // The guest may knock several times and more than one knock can open. The host alone
    // decides: the first connection that opens wins and is announced with a 'pick' message,
    // which is the only connection the guest adopts. A guest whose network blocks the direct
    // link never opens; drop it and keep waiting so the guest can retry.
    current.on('connection', (conn) => {
      if (current !== peer || !active()) return;
      pending.add(conn);
      onStatus('connecting');
      watchIce(conn, {
        onDiag,
        onFail() {
          pending.delete(conn);
          conn.close();
          if (current === peer && active() && !pending.size) onStatus('failed');
        },
      });
      conn.on('open', () => {
        pending.delete(conn);
        if (current !== peer || !active()) return conn.close();
        connected = true;
        pending.forEach((other) => other.close());
        pending.clear();
        stopWatching();
        conn.send({ t: 'pick' });
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

export function joinRoom(code, { onWaiting, onConnect, onError, onDiag }) {
  let cancelled = false;
  let done = false;
  let attempts = [];
  let knocker = null;
  let hostAnswered = false;
  const answered = new Set();
  const deadline = Date.now() + HOST_WAIT_MS;
  const peer = new Peer(PEER_OPTIONS);
  const timer = setTimeout(() => fail({ type: 'timeout' }), JOIN_TIMEOUT_MS);

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

  // Only attempts the host never answered are safe to abandon: an answered one may be the
  // connection the host is about to pick.
  function drop(conn, err) {
    if (done || !attempts.includes(conn)) return;
    attempts = attempts.filter((other) => other !== conn);
    conn.close();
    if (hostAnswered && !attempts.length) fail(err);
  }

  function adopt(conn, firstMessage) {
    stop();
    attempts.filter((other) => other !== conn).forEach((other) => other.close());
    attempts = [];
    onConnect(wrapConnection(conn, peer, firstMessage.t === 'pick' ? [] : [firstMessage]));
  }

  function connect() {
    if (cancelled || done) return;
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    attempts.push(conn);
    const unanswered = attempts.filter((other) => !answered.has(other));
    if (unanswered.length > KEPT_ATTEMPTS) drop(unanswered[0]);
    let pickTimer = null;

    watchIce(conn, {
      onDiag(text) {
        if (conn === attempts[attempts.length - 1] || answered.has(conn)) onDiag?.(text);
      },
      onAnswer() {
        if (done || !attempts.includes(conn)) return;
        answered.add(conn);
        hostAnswered = true;
        clearInterval(knocker);
        attempts.filter((other) => !answered.has(other)).forEach((other) => drop(other));
      },
      onFail: () => drop(conn, { type: 'ice-failed' }),
    });
    // An open connection the host didn't pick gets closed by the host, so wait for its 'pick'
    // (or, from an older host version, its first game message).
    conn.on('open', () => {
      pickTimer = setTimeout(() => drop(conn, { type: 'timeout' }), ICE_OPEN_MS);
    });
    const onData = (msg) => {
      if (done || !msg || msg.t === 'ping' || !attempts.includes(conn)) return;
      clearTimeout(pickTimer);
      conn.off('data', onData);
      adopt(conn, msg);
    };
    conn.on('data', onData);
    conn.on('close', () => {
      clearTimeout(pickTimer);
      drop(conn, { type: 'closed' });
    });
    conn.on('error', (err) => drop(conn, err));
  }

  // The host may still be in WhatsApp with the room temporarily gone, so keep knocking
  // until it answers; the server reports only the first knock on a missing room.
  function knockAgain() {
    if (hostAnswered) return;
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
