import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app

// Offline support: production builds only (a service worker would fight Vite's dev server).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.error('service worker', e)));
  // The page was drawn from the cached shell; when a newer one takes over, the app offers a reload. The first
  // worker taking control of a fresh install is not an update.
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (had) dispatchEvent(new Event('app-updated'));
    had = true;
  });
}
