import { createApp } from './ui/app';
import './ui/styles.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing #app element');

createApp(app);
