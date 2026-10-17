import { COLS, ROWS, other, applyMove, legalColumns } from './logic.js';

const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

function winningColumn(round, player) {
  for (const col of legalColumns(round)) {
    const next = applyMove(round, col, player);
    if (next?.result?.winner === player) return col;
  }
  return null;
}

function scoreWindow(cells, me) {
  const foe = other(me);
  const mine = cells.filter((c) => c === me).length;
  const theirs = cells.filter((c) => c === foe).length;
  const empty = cells.filter((c) => !c).length;
  if (mine === 4) return 1000;
  if (theirs === 4) return -1000;
  if (mine === 3 && empty === 1) return 50;
  if (mine === 2 && empty === 2) return 8;
  if (theirs === 3 && empty === 1) return -80;
  if (theirs === 2 && empty === 2) return -10;
  return 0;
}

function evaluate(board, me) {
  let score = 0;
  const center = board.reduce((n, row) => n + (row[3] === me ? 1 : 0), 0);
  score += center * 6;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) score += scoreWindow([0, 1, 2, 3].map((i) => board[r][c + i]), me);
      if (r + 3 < ROWS) score += scoreWindow([0, 1, 2, 3].map((i) => board[r + i][c]), me);
      if (r + 3 < ROWS && c + 3 < COLS) score += scoreWindow([0, 1, 2, 3].map((i) => board[r + i][c + i]), me);
      if (r + 3 < ROWS && c - 3 >= 0) score += scoreWindow([0, 1, 2, 3].map((i) => board[r + i][c - i]), me);
    }
  }
  return score;
}

function minimax(round, depth, maximizing, me, alpha, beta) {
  if (round.result) {
    if (!round.result.winner) return 0;
    return round.result.winner === me ? 10000 + depth : -10000 - depth;
  }
  if (depth === 0) return evaluate(round.board, me);

  const cols = legalColumns(round);
  const order = [3, 2, 4, 1, 5, 0, 6].filter((c) => cols.includes(c));

  if (maximizing) {
    let best = -Infinity;
    for (const col of order) {
      const next = applyMove(round, col, round.turn);
      const value = minimax(next, depth - 1, false, me, alpha, beta);
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const col of order) {
    const next = applyMove(round, col, round.turn);
    const value = minimax(next, depth - 1, true, me, alpha, beta);
    best = Math.min(best, value);
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function bestMove(round, me, depth) {
  const cols = legalColumns(round);
  const order = [3, 2, 4, 1, 5, 0, 6].filter((c) => cols.includes(c));
  let best = -Infinity;
  let picks = [];
  for (const col of order) {
    const next = applyMove(round, col, me);
    const value = minimax(next, depth - 1, false, me, -Infinity, Infinity);
    if (value > best) {
      best = value;
      picks = [col];
    } else if (value === best) {
      picks.push(col);
    }
  }
  return randomOf(picks);
}

export function pickMove(round, me, difficulty) {
  const cols = legalColumns(round);
  if (!cols.length) return 0;

  if (difficulty === 'easy') {
    const win = Math.random() < 0.35 ? winningColumn(round, me) : null;
    return win ?? randomOf(cols);
  }

  if (difficulty === 'medium') {
    return (
      winningColumn(round, me) ??
      (Math.random() < 0.8 ? winningColumn(round, other(me)) : null) ??
      bestMove(round, me, 3)
    );
  }

  return winningColumn(round, me) ?? winningColumn(round, other(me)) ?? bestMove(round, me, 5);
}
