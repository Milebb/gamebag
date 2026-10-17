import { COLS, ROWS, newRound, applyMove, other } from './logic.js';
import { pickMove } from './ai.js';
import { sound } from '../../sound.js';

const NAMES = {
  ai: { R: 'TI', Y: 'RAČUNALO' },
  local: { R: 'IGRAČ 1', Y: 'IGRAČ 2' },
  host: { R: 'TI', Y: 'PRIJATELJ' },
  guest: { R: 'PRIJATELJ', Y: 'TI' },
};

const TITLES = { ai: 'PROTIV RAČUNALA', local: 'DVOJE', online: 'ONLINE' };

/**
 * mode: 'ai' | 'local' | 'online'
 * Online, the host is R (pink) and owns the game state; the guest is Y and only sends moves.
 */
export function start(root, { mode, difficulty = 'medium', net = null, isHost = false, onExit }) {
  const online = mode === 'online';
  const me = online ? (isHost ? 'R' : 'Y') : mode === 'ai' ? 'R' : null;
  const names = online ? NAMES[isHost ? 'host' : 'guest'] : NAMES[mode];
  const authority = !online || isHost;

  let state = authority ? { round: newRound('R', 1), scores: { R: 0, Y: 0, draw: 0 } } : null;
  let prevRound = null;
  let ended = false;
  let aiTimer = null;

  root.innerHTML = `
    <main class="screen game">
      <div class="topbar">
        <button class="btn btn-small btn-ghost" data-action="exit">&lt; IZLAZ</button>
        <span class="title">4 U NIZU · ${TITLES[mode]}</span>
      </div>
      <div class="scoreboard">
        <div class="score x"><span class="label">● · ${names.R}</span><span class="value" data-score="R">0</span></div>
        <div class="score d"><span class="label">NERIJ.</span><span class="value" data-score="draw">0</span></div>
        <div class="score o"><span class="label">● · ${names.Y}</span><span class="value" data-score="Y">0</span></div>
      </div>
      <div class="c4-board" role="grid" aria-label="Ploča 4 u nizu">
        <div class="c4-cols">
          ${Array.from({ length: COLS }, (_, c) => `<button class="c4-col" data-c="${c}" aria-label="Stupac ${c + 1}"></button>`).join('')}
        </div>
        <div class="c4-grid">
          ${Array.from({ length: ROWS * COLS }, (_, i) => {
            const r = Math.floor(i / COLS);
            const c = i % COLS;
            return `<div class="c4-cell" data-r="${r}" data-c="${c}"></div>`;
          }).join('')}
        </div>
      </div>
      <p class="status" data-status></p>
      <div class="actions">
        <button class="btn btn-primary" data-action="next" hidden>NOVA RUNDA</button>
      </div>
    </main>`;

  const boardEl = root.querySelector('.c4-board');
  const cells = [...root.querySelectorAll('.c4-cell')];
  const statusEl = root.querySelector('[data-status]');
  const nextBtn = root.querySelector('[data-action="next"]');
  const scoreEls = Object.fromEntries([...root.querySelectorAll('[data-score]')].map((el) => [el.dataset.score, el]));
  const scoreBoxes = { R: root.querySelector('.score.x'), Y: root.querySelector('.score.o') };

  root.querySelector('.screen').addEventListener('click', (event) => {
    const colBtn = event.target.closest('.c4-col');
    if (colBtn) return onColumn(Number(colBtn.dataset.c));
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'exit') onExit();
    if (action === 'next') {
      sound.click();
      requestNextRound();
    }
  });

  function canPlay() {
    if (!state || ended || state.round.result) return false;
    return mode === 'local' || state.round.turn === me;
  }

  function onColumn(col) {
    if (!canPlay() || state.round.heights[col] >= ROWS) return;
    const player = mode === 'local' ? state.round.turn : me;
    if (authority) play(col, player);
    else net.send({ t: 'move', c: col });
  }

  function play(col, player) {
    const next = applyMove(state.round, col, player);
    if (!next) return;
    state.round = next;
    if (next.result) state.scores[next.result.winner ?? 'draw']++;
    commit();
  }

  function requestNextRound() {
    if (!state?.round.result) return;
    if (!authority) return net.send({ t: 'next' });
    const { starter, no } = state.round;
    state.round = newRound(other(starter), no + 1);
    commit();
  }

  function commit() {
    render();
    if (online && isHost) net.send({ t: 'state', state });
    scheduleAiMove();
  }

  function scheduleAiMove() {
    if (mode !== 'ai' || state.round.result || state.round.turn !== 'Y') return;
    clearTimeout(aiTimer);
    aiTimer = setTimeout(() => {
      aiTimer = null;
      play(pickMove(state.round, 'Y', difficulty), 'Y');
    }, 400 + Math.random() * 400);
  }

  function statusText(round) {
    if (round.result) {
      const { winner } = round.result;
      if (!winner) return 'NERIJEŠENO!';
      if (mode === 'local') return `${names[winner]} POBJEĐUJE!`;
      if (winner === me) return 'POBJEDA!';
      return mode === 'ai' ? 'RAČUNALO POBJEĐUJE!' : 'PRIJATELJ POBJEĐUJE!';
    }
    if (mode === 'local') return `${names[round.turn]} NA POTEZU`;
    if (round.turn === me) return 'TVOJ POTEZ';
    return mode === 'ai' ? 'RAČUNALO RAZMIŠLJA...' : 'PRIJATELJ JE NA POTEZU...';
  }

  function playResultSound(result) {
    if (!result.winner) return sound.draw();
    if (mode === 'local' || result.winner === me) sound.win();
    else sound.lose();
    navigator.vibrate?.(result.winner === me || mode === 'local' ? [60, 40, 60] : 200);
  }

  function cellAt(r, c) {
    return cells[r * COLS + c];
  }

  function render() {
    if (ended) return;
    if (!state) {
      statusEl.textContent = 'ČEKAM PODATKE...';
      return;
    }
    const { round, scores } = state;
    const sameRound = prevRound?.no === round.no;
    const winSet = new Set((round.result?.line ?? []).map(([r, c]) => `${r},${c}`));

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const value = round.board[r][c];
        const cell = cellAt(r, c);
        const isNew = value && sameRound && prevRound.board[r][c] !== value;
        cell.className = 'c4-cell';
        if (value === 'R') cell.classList.add('r');
        if (value === 'Y') cell.classList.add('y');
        if (isNew) {
          cell.classList.add('placed');
          sound.place(value === 'R' ? 'X' : 'O');
        }
        if (winSet.has(`${r},${c}`)) cell.classList.add('win');
      }
    }

    if (round.result && !(sameRound && prevRound.result)) playResultSound(round.result);

    boardEl.classList.toggle('locked', !canPlay());
    scoreEls.R.textContent = scores.R;
    scoreEls.Y.textContent = scores.Y;
    scoreEls.draw.textContent = scores.draw;
    scoreBoxes.R.classList.toggle('active', !round.result && round.turn === 'R');
    scoreBoxes.Y.classList.toggle('active', !round.result && round.turn === 'Y');
    statusEl.textContent = statusText(round);
    nextBtn.hidden = !round.result;
    prevRound = {
      no: round.no,
      board: round.board.map((row) => row.slice()),
      result: round.result,
    };
  }

  function opponentLeft() {
    if (ended) return;
    ended = true;
    boardEl.classList.add('locked');
    statusEl.textContent = 'PRIJATELJ JE IZAŠAO';
    nextBtn.textContent = 'NATRAG U IZBORNIK';
    nextBtn.dataset.action = 'exit';
    nextBtn.hidden = false;
  }

  const sayBye = () => net.send({ t: 'bye' });

  if (online) {
    net.setHandler((msg) => {
      if (msg.t === 'bye') return opponentLeft();
      if (isHost) {
        if (msg.t === 'move') play(msg.c, 'Y');
        else if (msg.t === 'next') requestNextRound();
      } else if (msg.t === 'state') {
        state = msg.state;
        render();
      }
    });
    net.onClose(opponentLeft);
    if (isHost) net.onResume(() => net.send({ t: 'state', state }));
    window.addEventListener('pagehide', sayBye);
    if (isHost) net.send({ t: 'state', state });
  }

  render();
  scheduleAiMove();

  return () => {
    clearTimeout(aiTimer);
    if (online) {
      window.removeEventListener('pagehide', sayBye);
      if (!ended) sayBye();
      net.close();
    }
  };
}
