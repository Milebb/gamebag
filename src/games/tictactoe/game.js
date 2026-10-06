import { newRound, applyMove, other } from './logic.js';
import { pickMove } from './ai.js';
import { sound } from '../../sound.js';

const NAMES = {
  ai: { X: 'TI', O: 'RAČUNALO' },
  local: { X: 'IGRAČ 1', O: 'IGRAČ 2' },
  host: { X: 'TI', O: 'PRIJATELJ' },
  guest: { X: 'PRIJATELJ', O: 'TI' },
};

const TITLES = { ai: 'PROTIV RAČUNALA', local: 'DVOJE', online: 'ONLINE' };

/**
 * mode: 'ai' | 'local' | 'online'
 * Online, the host is X and owns the game state; the guest is O and only sends moves.
 */
export function start(root, { mode, difficulty = 'medium', net = null, isHost = false, onExit }) {
  const online = mode === 'online';
  const me = online ? (isHost ? 'X' : 'O') : mode === 'ai' ? 'X' : null;
  const names = online ? NAMES[isHost ? 'host' : 'guest'] : NAMES[mode];
  const authority = !online || isHost;

  let state = authority ? { round: newRound('X', 1), scores: { X: 0, O: 0, draw: 0 } } : null;
  let prevRound = null;
  let ended = false;
  let aiTimer = null;

  root.innerHTML = `
    <main class="screen game">
      <div class="topbar">
        <button class="btn btn-small btn-ghost" data-action="exit">&lt; IZLAZ</button>
        <span class="title">${TITLES[mode]}</span>
      </div>
      <div class="scoreboard">
        <div class="score x"><span class="label">X · ${names.X}</span><span class="value" data-score="X">0</span></div>
        <div class="score d"><span class="label">NERIJ.</span><span class="value" data-score="draw">0</span></div>
        <div class="score o"><span class="label">O · ${names.O}</span><span class="value" data-score="O">0</span></div>
      </div>
      <div class="board">
        ${Array.from({ length: 9 }, (_, i) => `<button class="cell" data-i="${i}" aria-label="Polje ${i + 1}"></button>`).join('')}
      </div>
      <p class="status" data-status></p>
      <div class="actions">
        <button class="btn btn-primary" data-action="next" hidden>NOVA RUNDA</button>
      </div>
    </main>`;

  const screen = root.querySelector('.screen');
  const board = root.querySelector('.board');
  const cells = [...root.querySelectorAll('.cell')];
  const statusEl = root.querySelector('[data-status]');
  const nextBtn = root.querySelector('[data-action="next"]');
  const scoreEls = Object.fromEntries([...root.querySelectorAll('[data-score]')].map((el) => [el.dataset.score, el]));
  const scoreBoxes = { X: root.querySelector('.score.x'), O: root.querySelector('.score.o') };

  screen.addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (cell) return onCell(Number(cell.dataset.i));
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

  function onCell(index) {
    if (!canPlay() || state.round.board[index]) return;
    const player = mode === 'local' ? state.round.turn : me;
    if (authority) play(index, player);
    else net.send({ t: 'move', i: index });
  }

  function play(index, player) {
    const next = applyMove(state.round, index, player);
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
    if (mode !== 'ai' || state.round.result || state.round.turn !== 'O') return;
    clearTimeout(aiTimer);
    aiTimer = setTimeout(() => {
      aiTimer = null;
      play(pickMove(state.round.board, 'O', difficulty), 'O');
    }, 450 + Math.random() * 350);
  }

  function statusText(round) {
    if (round.result) {
      const { winner } = round.result;
      if (!winner) return 'NERIJEŠENO!';
      if (mode === 'local') return `${names[winner]} POBJEĐUJE!`;
      if (winner === me) return 'POBJEDA!';
      return mode === 'ai' ? 'RAČUNALO POBJEĐUJE!' : 'PRIJATELJ POBJEĐUJE!';
    }
    if (mode === 'local') return `${names[round.turn]} (${round.turn}) NA POTEZU`;
    if (round.turn === me) return 'TVOJ POTEZ';
    return mode === 'ai' ? 'RAČUNALO RAZMIŠLJA...' : 'PRIJATELJ JE NA POTEZU...';
  }

  function playResultSound(result) {
    if (!result.winner) return sound.draw();
    if (mode === 'local' || result.winner === me) sound.win();
    else sound.lose();
    navigator.vibrate?.(result.winner === me || mode === 'local' ? [60, 40, 60] : 200);
  }

  function render() {
    if (ended) return;
    if (!state) {
      statusEl.textContent = 'ČEKAM PODATKE...';
      return;
    }
    const { round, scores } = state;
    const sameRound = prevRound?.no === round.no;

    cells.forEach((cell, i) => {
      const value = round.board[i];
      const isNew = value && sameRound && prevRound.board[i] !== value;
      cell.innerHTML = value ? `<span class="mark">${value}</span>` : '';
      cell.className = 'cell';
      if (value) cell.classList.add(value.toLowerCase());
      if (isNew) {
        cell.classList.add('placed');
        sound.place(value);
      }
      if (round.result?.line?.includes(i)) cell.classList.add('win');
    });

    if (round.result && !(sameRound && prevRound.result)) playResultSound(round.result);

    board.classList.toggle('locked', !canPlay());
    scoreEls.X.textContent = scores.X;
    scoreEls.O.textContent = scores.O;
    scoreEls.draw.textContent = scores.draw;
    scoreBoxes.X.classList.toggle('active', !round.result && round.turn === 'X');
    scoreBoxes.O.classList.toggle('active', !round.result && round.turn === 'O');
    statusEl.textContent = statusText(round);
    nextBtn.hidden = !round.result;
    prevRound = round;
  }

  function opponentLeft() {
    if (ended) return;
    ended = true;
    board.classList.add('locked');
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
        if (msg.t === 'move') play(msg.i, 'O');
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
