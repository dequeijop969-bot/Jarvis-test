// Sessão da requisição atual (AsyncLocalStorage): permite que github.js use o token do login sem estado global.
import { AsyncLocalStorage } from 'node:async_hooks';
const als = new AsyncLocalStorage();
export const runWith = (sess, fn) => als.run(sess || null, fn);
export const current = () => als.getStore() || null;
export const loginToken = () => current()?.gh?.access || null;
