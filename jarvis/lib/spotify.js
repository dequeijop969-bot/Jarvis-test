// Spotify (Web API, OAuth 2.0 com PKCE). Login em Ajustes; tokens em data/tokens.local.json (como o Canva e o Google).
// Configuração: app em developer.spotify.com com o redirect http://127.0.0.1:PORTA/auth/spotify/callback (o Spotify não
// aceita "localhost") e SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET no .env. Controlar a reprodução exige conta Premium;
// sem ela, o Jarvis ainda lê o que está tocando e as playlists, e tocar cai no caminho antigo (abrir a busca no app).
import { startFlow, finishFlow, getTokens, setTokens } from './oauth.js';
import { PORT } from './config.js';

const cfg = () => ({ id: process.env.SPOTIFY_CLIENT_ID || '', secret: process.env.SPOTIFY_CLIENT_SECRET || '', redirect: process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/auth/spotify/callback` });
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read user-top-read';
export const configured = () => !!(cfg().id && cfg().secret);
export const connected = () => configured() && !!getTokens('spotify')?.refresh_token;

export function status() {
  if (!configured()) return { state: 'off', configured: false, message: 'Coloque SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET no .env.' };
  const t = getTokens('spotify');
  return t?.refresh_token ? { state: 'on', configured: true, message: t.name ? `Conectado como ${t.name}${t.premium === false ? ' (sem Premium: só leitura)' : ''}.` : 'Conectado.', premium: t.premium !== false }
    : { state: 'off', configured: true, message: 'Não conectado.' };
}

export function authRedirect() {
  const c = cfg(), { state, challenge } = startFlow('spotify');
  const u = new URL('https://accounts.spotify.com/authorize');
  u.search = new URLSearchParams({ client_id: c.id, response_type: 'code', redirect_uri: c.redirect, scope: SCOPES, state, code_challenge_method: 'S256', code_challenge: challenge });
  return u.toString();
}
const basic = () => 'Basic ' + Buffer.from(`${cfg().id}:${cfg().secret}`).toString('base64');
async function token(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error('O Spotify recusou o acesso. Conecte de novo em Ajustes.'), { code: 401 });
  return j;
}
export async function callback(q) {
  const verifier = finishFlow('spotify', q.get('state'));
  if (!verifier || q.get('error')) throw new Error('Login no Spotify cancelado ou expirado.');
  const j = await token({ grant_type: 'authorization_code', code: q.get('code') || '', redirect_uri: cfg().redirect, code_verifier: verifier });
  setTokens('spotify', { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, scope: j.scope });
  try {   // nome e plano (Premium libera o controle da reprodução)
    const me = await api('GET', '/me');
    setTokens('spotify', { ...getTokens('spotify'), name: me?.display_name || '', premium: me?.product === 'premium' });
  } catch { /* opcional */ }
}
export function disconnect() { setTokens('spotify', null); }

// Chamada à Web API: renova o acesso quando vence (e uma vez se o Spotify disser 401).
async function access(force) {
  const t = getTokens('spotify');
  if (!t?.refresh_token) throw Object.assign(new Error('O Spotify não está conectado. Conecte em Ajustes.'), { code: 401 });
  if (!force && t.access_token && t.expires_at > Date.now() + 60_000) return t.access_token;
  const j = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  setTokens('spotify', { ...t, access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}
export async function api(method, path, body, retry = true) {
  const r = await fetch(`https://api.spotify.com/v1${path}`, {
    method, headers: { authorization: `Bearer ${await access(false)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  if (r.status === 401 && retry) { await access(true); return api(method, path, body, false); }
  if (r.status === 204 || r.status === 202) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const reason = j?.error?.reason || j?.error?.message || '';
    const msg = r.status === 403 ? 'O Spotify só deixa controlar a música com conta Premium.' : r.status === 404 ? 'Nenhum Spotify aberto para tocar.' : r.status === 429 ? 'O Spotify pediu um tempo. Tente em instantes.' : `O Spotify respondeu com erro (${r.status}).`;
    throw Object.assign(new Error(msg), { code: r.status, reason });
  }
  return j;
}

/* ---------- Leitura ---------- */
const artists = it => (it?.artists || []).map(a => a.name).slice(0, 2).join(' e ');
export async function nowPlaying() {
  const j = await api('GET', '/me/player?additional_types=episode');
  if (!j?.item) return null;
  return { name: j.item.name, artist: artists(j.item) || j.item.show?.name || '', playing: !!j.is_playing, device: j.device?.name || '', volume: j.device?.volume_percent ?? null,
    image: j.item.album?.images?.[0]?.url || j.item.images?.[0]?.url || '' };
}
async function devices() { return (await api('GET', '/me/player/devices'))?.devices || []; }
// Um Spotify aberto para tocar: o ativo, o deste PC (Computer) ou o primeiro da lista. Sem nenhum: abrir o app e esperar.
export async function pickDevice(openApp) {
  let list = await devices();
  if (!list.length && openApp) {
    await openApp();
    for (let i = 0; i < 12 && !list.length; i++) { await new Promise(z => setTimeout(z, 1000)); list = await devices(); }
  }
  return list.find(d => d.is_active) || list.find(d => d.type === 'Computer') || list[0] || null;
}

/* ---------- Controle ---------- */
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// O que tocar: "minhas curtidas", uma playlist sua com esse nome, ou a busca (artista, playlist, álbum ou música).
export async function resolve(q) {
  const f = fold(q);
  if (/^(minhas? )?(musicas? )?(curtidas|favoritas|que eu curti)$/.test(f)) {
    const s = await api('GET', '/me/tracks?limit=50');
    const uris = (s?.items || []).map(x => x.track?.uri).filter(Boolean);
    return uris.length ? { uris, label: 'as suas músicas curtidas' } : null;
  }
  const mine = f.match(/^(?:minha |a minha )?playlist (?:de |do |da )?(.+)$/) || f.match(/^minha (.+)$/);
  if (mine) {
    const pl = await api('GET', '/me/playlists?limit=50');
    const want = fold(mine[1]);
    const hit = (pl?.items || []).find(p => fold(p.name) === want) || (pl?.items || []).find(p => fold(p.name).includes(want));
    if (hit) return { context_uri: hit.uri, label: `a sua playlist ${hit.name}` };
  }
  const s = await api('GET', `/search?${new URLSearchParams({ q, type: 'track,artist,playlist,album', limit: '5', market: 'from_token' })}`);
  const ar = (s?.artists?.items || [])[0], tr = (s?.tracks?.items || [])[0], pl = (s?.playlists?.items || []).filter(Boolean)[0], al = (s?.albums?.items || [])[0];
  // Nome do artista igual ao pedido: toca o artista. "rock pra focar", "lo-fi": playlist. Senão, a música.
  if (ar && fold(ar.name) === f) return { context_uri: ar.uri, label: ar.name };
  if (pl && /\b(playlist|pra|para|focar|estudar|treino|relaxar|dormir|lofi|lo fi|hits|top|mix)\b/.test(f)) return { context_uri: pl.uri, label: `a playlist ${pl.name}` };
  if (tr) return { uris: [tr.uri], label: `${tr.name}, de ${artists(tr)}` };
  if (al) return { context_uri: al.uri, label: `o álbum ${al.name}` };
  if (pl) return { context_uri: pl.uri, label: `a playlist ${pl.name}` };
  return null;
}
export async function play(q, openApp) {
  const what = await resolve(q);
  if (!what) throw Object.assign(new Error(`Não achei "${q}" no Spotify.`), { code: 404 });
  const dev = await pickDevice(openApp);
  if (!dev) throw Object.assign(new Error('Nenhum Spotify aberto para tocar.'), { code: 404 });
  const { label, ...body } = what;
  await api('PUT', `/me/player/play?device_id=${encodeURIComponent(dev.id)}`, body);
  return { label, device: dev.name };
}
export async function control(op, arg) {
  if (op === 'next') return api('POST', '/me/player/next');
  if (op === 'prev') return api('POST', '/me/player/previous');
  if (op === 'pause') return api('PUT', '/me/player/pause');
  if (op === 'resume') return api('PUT', '/me/player/play');
  if (op === 'shuffle') return api('PUT', `/me/player/shuffle?state=${arg ? 'true' : 'false'}`);
  if (op === 'volume') {
    let v = arg;
    if (typeof v !== 'number') { const n = await nowPlaying(); const cur = n?.volume ?? 50; v = cur + (arg === 'up' ? 15 : -15); }
    v = Math.max(0, Math.min(100, Math.round(v)));
    await api('PUT', `/me/player/volume?volume_percent=${v}`);
    return v;
  }
  throw new Error('comando desconhecido');
}
