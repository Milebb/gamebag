import { start as startTicTacToe } from './tictactoe/game.js';
import { pixelSvg, ICONS } from '../pixel.js';

export const games = [
  { id: 'ttt', name: 'KRIŽIĆ-KRUŽIĆ', icon: pixelSvg(ICONS.ttt), available: true, start: startTicTacToe },
  { id: 'pong', name: 'PONG', icon: pixelSvg(ICONS.pong), available: false },
  { id: 'invaders', name: 'SVEMIRCI', icon: pixelSvg(ICONS.invader), available: false },
];

export const getGame = (id) => games.find((game) => game.id === id && game.available);
