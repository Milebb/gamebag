import { start as startTicTacToe } from './tictactoe/game.js';
import { start as startPong } from './pong/game.js';
import { start as startInvaders } from './invaders/game.js';
import { start as startConnect4 } from './connect4/game.js';
import { start as startHockey } from './hockey/game.js';
import { start as startSnake } from './snake/game.js';
import { start as startBreakout } from './breakout/game.js';
import { pixelSvg, ICONS } from '../pixel.js';

export const DEFAULT_MODES = [
  { mode: 'ai', label: 'SAM PROTIV RAČUNALA' },
  { mode: 'local', label: 'DVOJE NA JEDNOM MOBITELU' },
  { mode: 'online', label: 'POZOVI PRIJATELJA' },
];

export const games = [
  {
    id: 'ttt',
    name: 'KRIŽIĆ-KRUŽIĆ',
    icon: pixelSvg(ICONS.ttt),
    available: true,
    hardLabel: 'NEPOBJEDIVO',
    invite: '❌⭕ Izazivam te na križić-kružić u Gamebagu!',
    start: startTicTacToe,
  },
  {
    id: 'connect4',
    name: '4 U NIZU',
    icon: pixelSvg(ICONS.connect4),
    available: true,
    hardLabel: 'TEŠKO',
    invite: '🔴🟡 Izazivam te na 4 u nizu u Gamebagu!',
    start: startConnect4,
  },
  {
    id: 'pong',
    name: 'PONG',
    icon: pixelSvg(ICONS.pong),
    available: true,
    hardLabel: 'TEŠKO',
    invite: '🏓 Izazivam te na Pong u Gamebagu!',
    start: startPong,
  },
  {
    id: 'hockey',
    name: 'AIR HOCKEY',
    icon: pixelSvg(ICONS.hockey),
    available: true,
    hardLabel: 'TEŠKO',
    invite: '🏒 Izazivam te na Air Hockey u Gamebagu!',
    start: startHockey,
  },
  {
    id: 'snake',
    name: 'ZMIJA',
    icon: pixelSvg(ICONS.snake),
    available: true,
    hardLabel: 'BRZO',
    modes: [
      { mode: 'ai', label: 'SAM' },
      { mode: 'local', label: 'DVOJE NA JEDNOM MOBITELU' },
      { mode: 'online', label: 'POZOVI PRIJATELJA' },
    ],
    invite: '🐍 Izazivam te na Zmiju u Gamebagu!',
    start: startSnake,
  },
  {
    id: 'breakout',
    name: 'CIGLE',
    icon: pixelSvg(ICONS.breakout),
    available: true,
    hardLabel: 'TEŠKO',
    modes: [
      { mode: 'ai', label: 'SAM' },
      { mode: 'local', label: 'ZAJEDNO NA JEDNOM MOBITELU' },
      {
        mode: 'online',
        label: 'POZOVI PRIJATELJA: ZAJEDNO',
        subtitle: 'ZAJEDNO',
        invite: '🧱 Pomozi mi razbiti cigle u Gamebagu!',
      },
    ],
    invite: '🧱 Igrajmo Cigle u Gamebagu!',
    start: startBreakout,
  },
  {
    id: 'invaders',
    name: 'SVEMIRCI',
    icon: pixelSvg(ICONS.invader),
    available: true,
    hardLabel: 'TEŠKO',
    modes: [
      { mode: 'ai', label: 'SAM' },
      { mode: 'local', label: 'ZAJEDNO NA JEDNOM MOBITELU' },
      {
        mode: 'online',
        variant: 'coop',
        label: 'POZOVI PRIJATELJA: ZAJEDNO',
        subtitle: 'ZAJEDNO',
        invite: '👾 Pomozi mi obraniti Zemlju od svemiraca u Gamebagu!',
      },
      {
        mode: 'online',
        variant: 'versus',
        label: 'POZOVI PRIJATELJA: DVOBOJ',
        subtitle: 'BROD PROTIV SVEMIRACA',
        invite: '👾 Izazivam te na dvoboj u Svemircima: brod protiv svemiraca!',
      },
    ],
    start: startInvaders,
  },
];

export const getGame = (id) => games.find((game) => game.id === id && game.available);
