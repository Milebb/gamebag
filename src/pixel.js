export const PALETTE = {
  x: '#ff2e88',
  o: '#22e4ff',
  g: '#39ff14',
  y: '#ffe14d',
  '#': '#5a5a8a',
};

export const ICONS = {
  ttt: [
    'x.x#ooo#...',
    '.x.#o.o#...',
    'x.x#ooo#...',
    '###########',
    '...#x.x#ooo',
    '...#.x.#o.o',
    '...#x.x#ooo',
    '###########',
    'ooo#...#x.x',
    'o.o#...#.x.',
    'ooo#...#x.x',
  ],
  pong: [
    '...........',
    'o..........',
    'o.........x',
    'o....y....x',
    'o.........x',
    '..........x',
    '...........',
  ],
  invader: [
    '..g.....g..',
    '...g...g...',
    '..ggggggg..',
    '.gg.ggg.gg.',
    'ggggggggggg',
    'g.ggggggg.g',
    'g.g.....g.g',
    '...gg.gg...',
  ],
};

export function pixelSvg(rows, palette = PALETTE) {
  const width = rows[0].length;
  const height = rows.length;
  let rects = '';
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (palette[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch]}"/>`;
    });
  });
  return `<svg class="pixel-icon" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
