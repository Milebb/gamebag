import { start as startTicTacToe } from './tictactoe/game.js';
import { start as startPong } from './pong/game.js';
import { start as startInvaders } from './invaders/game.js';
import { pixelSvg, ICONS } from '../pixel.js';

export const DEFAULT_MODES = [
  { mode: 'ai', label: 'SAM PROTIV RAČUNALA' },
  { mode: 'local', label: 'DVOJE NA JEDNOM MOBITELU' },
  { mode: 'online', label: 'ONLINE S PRIJATELJEM' },
];

export const games = [
  {
    id: 'ttt',
    name: 'KRIŽIĆ-KRUŽIĆ',
    icon: pixelSvg(ICONS.ttt),
    available: true,
    hardLabel: 'NEPOBJEDIVO',
    start: startTicTacToe,
  },
  { id: 'pong', name: 'PONG', icon: pixelSvg(ICONS.pong), available: true, hardLabel: 'TEŠKO', start: startPong },
  {
    id: 'invaders',
    name: 'SVEMIRCI',
    icon: pixelSvg(ICONS.invader),
    available: true,
    hardLabel: 'TEŠKO',
    modes: [
      { mode: 'ai', label: 'SAM' },
      { mode: 'local', label: 'ZAJEDNO NA JEDNOM MOBITELU' },
      { mode: 'online', variant: 'coop', label: 'ONLINE ZAJEDNO' },
      { mode: 'online', variant: 'versus', label: 'ONLINE: BROD PROTIV SVEMIRACA' },
    ],
    start: startInvaders,
  },
];

export const getGame = (id) => games.find((game) => game.id === id && game.available);
