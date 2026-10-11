import { App } from './app/App';

const root = document.getElementById('app')!;
const app = new App(root);
(window as unknown as { PARALLAX: App }).PARALLAX = app;
app.start().catch((e) => console.error(e));
