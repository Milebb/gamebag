// Classic-style pixel sprites. Each alien type has two animation frames.
export const ALIENS = [
  [
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X'],
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '.X.XX.X.', 'X......X', '.X....X.'],
  ],
  [
    ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
    ['..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.X.......X.'],
  ],
  [
    ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '...XX..XX...', '..XX.XX.XX..', 'XX........XX'],
    ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '..XXX..XXX..', '.XX..XX..XX.', '..XX....XX..'],
  ],
];

// Alien type per row (top to bottom), like the original.
export const ROW_TYPE = [0, 1, 1, 2, 2];

export const SHIP = ['.....X.....', '....XXX....', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX', 'XXXXXXXXXXX'];

export const EXPLOSION = ['X...X...X', '.X..X..X.', '..X...X..', 'XX.....XX', '..X...X..', '.X..X..X.', 'X...X...X'];

const cache = new Map();

/** Renders a bitmap to an offscreen canvas (1 canvas pixel per sprite pixel), cached per color. */
export function sprite(bitmap, color) {
  const key = `${bitmap.join('|')}#${color}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap[0].length;
  canvas.height = bitmap.length;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  bitmap.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && ctx.fillRect(x, y, 1, 1)));
  cache.set(key, canvas);
  return canvas;
}
