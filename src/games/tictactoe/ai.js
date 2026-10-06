import { winnerOf, other } from './logic.js';

const emptyCells = (board) => board.flatMap((v, i) => (v ? [] : [i]));
const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

function winningMove(board, player) {
  for (const i of emptyCells(board)) {
    const next = board.slice();
    next[i] = player;
    if (winnerOf(next)?.winner === player) return i;
  }
  return null;
}

function minimax(board, turn, me, depth) {
  const result = winnerOf(board);
  if (result) {
    if (!result.winner) return 0;
    return result.winner === me ? 10 - depth : depth - 10;
  }
  const scores = emptyCells(board).map((i) => {
    const next = board.slice();
    next[i] = turn;
    return minimax(next, other(turn), me, depth + 1);
  });
  return turn === me ? Math.max(...scores) : Math.min(...scores);
}

function perfectMove(board, me) {
  let best = -Infinity;
  let bestMoves = [];
  for (const i of emptyCells(board)) {
    const next = board.slice();
    next[i] = me;
    const score = minimax(next, other(me), me, 1);
    if (score > best) {
      best = score;
      bestMoves = [i];
    } else if (score === best) {
      bestMoves.push(i);
    }
  }
  return randomOf(bestMoves);
}

export function pickMove(board, me, difficulty) {
  const empty = emptyCells(board);
  if (difficulty === 'easy') {
    const win = Math.random() < 0.3 ? winningMove(board, me) : null;
    return win ?? randomOf(empty);
  }
  if (difficulty === 'medium') {
    return (
      winningMove(board, me) ??
      (Math.random() < 0.75 ? winningMove(board, other(me)) : null) ??
      (board[4] === null && Math.random() < 0.5 ? 4 : randomOf(empty))
    );
  }
  return perfectMove(board, me);
}
