const STORAGE_KEY = 'gamebag-muted';

let ctx = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Private mode: the setting just won't persist.
  }
}

function tone(freq, duration = 0.08, delay = 0, volume = 0.05) {
  if (muted) return;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    return;
  }
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

const melody = (notes, step, duration) => notes.forEach((freq, i) => tone(freq, duration, i * step));

export const sound = {
  click: () => tone(660, 0.04),
  place: (player) => tone(player === 'X' ? 520 : 390, 0.09),
  win: () => melody([523, 659, 784, 1047], 0.1, 0.12),
  lose: () => melody([392, 330, 262], 0.14, 0.16),
  draw: () => melody([440, 440], 0.15, 0.1),
  join: () => melody([660, 880], 0.09, 0.08),
  hit: () => tone(620, 0.05),
  wall: () => tone(310, 0.04, 0, 0.035),
  point: () => melody([660, 990], 0.08, 0.08),
  miss: () => tone(160, 0.3),
};
