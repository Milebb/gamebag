export const COLS = 7;
export const ROWS = 6;
export const other = (player) => (player === 'R' ? 'Y' : 'R');

export function newRound(starter = 'R', no = 1) {
  return {
    no,
    board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
    heights: Array(COLS).fill(0),
    turn: starter,
    starter,
    result: null,
  };
}

function lineAt(board, r, c, dr, dc, player) {
  const cells = [[r, c]];
  for (const dir of [1, -1]) {
    let rr = r + dr * dir;
    let cc = c + dc * dir;
    while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === player) {
      cells.push([rr, cc]);
      rr += dr * dir;
      cc += dc * dir;
    }
  }
  return cells.length >= 4 ? cells.slice(0, 4) : null;
}

/** Returns { winner, line } when won, { winner: null, line: null } on a draw, or null while still playing. */
export function winnerOf(board, lastRow, lastCol) {
  if (lastRow == null) return null;
  const player = board[lastRow][lastCol];
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const line = lineAt(board, lastRow, lastCol, dr, dc, player);
    if (line) return { winner: player, line };
  }
  const full = board.every((row) => row.every(Boolean));
  return full ? { winner: null, line: null } : null;
}

export function legalColumns(round) {
  return round.heights.flatMap((h, c) => (h < ROWS ? [c] : []));
}

/** Returns the next round state, or null if the move is not allowed. */
export function applyMove(round, col, player) {
  if (round.result || round.turn !== player) return null;
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return null;
  if (round.heights[col] >= ROWS) return null;

  const row = ROWS - 1 - round.heights[col];
  const board = round.board.map((r) => r.slice());
  board[row][col] = player;
  const heights = round.heights.slice();
  heights[col]++;
  return {
    ...round,
    board,
    heights,
    turn: other(player),
    result: winnerOf(board, row, col),
    last: { row, col },
  };
}
