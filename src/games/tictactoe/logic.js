export const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const other = (player) => (player === 'X' ? 'O' : 'X');

/** Returns { winner, line } when won, { winner: null, line: null } on a draw, or null while still playing. */
export function winnerOf(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line };
  }
  return board.every(Boolean) ? { winner: null, line: null } : null;
}

export function newRound(starter = 'X', no = 1) {
  return { no, board: Array(9).fill(null), turn: starter, starter, result: null };
}

/** Returns the next round state, or null if the move is not allowed. */
export function applyMove(round, index, player) {
  if (round.result || round.turn !== player) return null;
  if (!Number.isInteger(index) || index < 0 || index > 8 || round.board[index]) return null;
  const board = round.board.slice();
  board[index] = player;
  return { ...round, board, turn: other(player), result: winnerOf(board) };
}
