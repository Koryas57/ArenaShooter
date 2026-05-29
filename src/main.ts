import './styles.css';
import { Game } from './game/Game';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app mount node.');
}

const game = new Game(app);
game.start();
