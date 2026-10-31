// Busca de imagens: Google (Programmable Search, searchType=image) quando configurado; senão Openverse (sem chave).
// O navegador nunca recebe URL externa para buscar: ele pede por ID, e o servidor só baixa o que ELE MESMO
// devolveu numa busca recente (sem URL arbitrária = sem SSRF por parâmetro). IPs privados são recusados.
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { registerSecret } from './secrets.js';

const TTL = 60 * 60_000;          // resultados valem 1 h
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT = 12_000;
const reg = new Map();            // id -> { url, thumb, title, ... , exp }
const thumbs = new Map();         // id -> { type, buf } (cache pequeno das miniaturas)

export const IMAGES = { resolve: lookup }; // trocável nos testes

const env = k => (process.env[k] || '').trim();
export function googleConfigured() { return !!(env('GOOGLE_CSE_KEY') && env('GOOGLE_CSE_ID')); }
export function imagesStatus() {
  return googleConfigured()
    ? { provider: 'google', label: 'Google Imagens', message: 'Busca pelo Google (Programmable Search).' }
    : { provider: 'openverse', label: 'Openverse', message: 'Sem chave do Google: usando o Openverse (imagens abertas, sem chave). Configure GOOGLE_CSE_KEY e GOOGLE_CSE_ID no .env para buscar no Google.' };
}

const clean = (s, n = 140) => String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const okUrl = u => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
// Na Vercel cada pedido pode cair numa instância diferente, e o registro em memória não estaria lá. No modo site o ID leva a
// própria URL, assinada com JARVIS_SESSION_SECRET: o servidor só baixa o que ele mesmo assinou (continua sem URL arbitrária).
const sealKey = () => { const s = process.env.JARVIS_SITE_ONLY === '1' ? process.env.JARVIS_SESSION_SECRET || '' : ''; return s.length >= 32 ? s : ''; };
const mac = (k, body) => createHmac('sha256', k).update('img:' + body).digest('base64url').slice(0, 22);
function newId(url, thumb, title) {
  const k = sealKey(); if (!k) return randomBytes(8).toString('hex');
  const body = Buffer.from(JSON.stringify({ u: url, t: thumb && thumb !== url ? thumb : undefined, n: String(title || '').slice(0, 80), e: Date.now() + TTL })).toString('base64url');
  return `w${body}.${mac(k, body)}`;
}
function unseal(id) {
  const k = sealKey(), m = /^w([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/.exec(String(id)); if (!k || !m) return null;
  const a = Buffer.from(mac(k, m[1])), b = Buffer.from(m[2]); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const j = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')), url = okUrl(j.u);
    if (!url || !(j.e > Date.now())) return null;
    return { id, url, thumb: okUrl(j.t) || url, title: clean(j.n) || 'foto', source: '', page: '', exp: j.e };
  } catch { return null; }
}
function prune() { const t = Date.now(); for (const [k, v] of reg) if (v.exp < t) { reg.delete(k); thumbs.delete(k); } }

async function getJSON(url, headers = {}) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'JARVIS-local/3 (assistente pessoal)', ...headers }, signal: ac.signal });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return await r.json();
  } finally { clearTimeout(t); }
}

async function searchGoogle(q, n, safe) {
  const key = env('GOOGLE_CSE_KEY'); registerSecret(key);
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.search = new URLSearchParams({ key, cx: env('GOOGLE_CSE_ID'), q, searchType: 'image', num: String(Math.min(10, n)), safe: safe ? 'active' : 'off', hl: 'pt-BR' });
  const j = await getJSON(u.href);
  return (j.items || []).map(it => ({
    url: it.link, thumb: it.image?.thumbnailLink || it.link, title: it.title, source: it.displayLink,
    page: it.image?.contextLink, width: it.image?.width, height: it.image?.height, mime: it.mime, license: ''
  }));
}
async function searchOpenverse(q, n, safe) {
  const u = new URL('https://api.openverse.org/v1/images/');
  u.search = new URLSearchParams({ q, page_size: String(Math.min(20, n)), ...(safe ? { mature: 'false' } : {}) });
  const j = await getJSON(u.href);
  return (j.results || []).map(it => ({
    url: it.url, thumb: it.thumbnail || it.url, title: it.title, source: it.source || it.provider,
    page: it.foreign_landing_url, width: it.width, height: it.height, mime: '',
    license: it.license ? `CC ${String(it.license).toUpperCase()} ${it.license_version || ''}`.trim() : '', creator: it.creator
  }));
}

// Variações cada vez mais simples: "meme do verity" → "meme verity" → "verity" → "meme".
const STOP = /^(de|do|da|dos|das|o|a|os|as|um|uma|uns|umas|e|em|no|na|com|sobre|pra|para)$/i;
const GENERIC = /^(memes?|gifs?|figurinhas?|imagens?|fotos?|fotografias?|figuras?|wallpapers?|engra[cç]ad[oa]s?)$/i;
export function relaxations(q) {
  const w = q.split(/\s+/).filter(x => !STOP.test(x)), core = w.filter(x => !GENERIC.test(x)), out = [q, w.join(' '), core.join(' '), core.slice(-2).join(' '), core.at(-1), w[0]];
  return [...new Set(out.filter(x => x && x.length >= 2))];
}

export async function searchImages(query, opts = {}) {
  const q = clean(query, 120);
  if (q.length < 2) throw Object.assign(new Error('Diga o que procurar.'), { code: 400 });
  // Sem resultado exato, tenta versões mais curtas antes de desistir (o Openverse não acha memes de nicho).
  let last = null;
  for (const v of relaxations(q).slice(0, opts.relaxSteps || 4)) {
    last = await searchOnce(v, opts);
    if (last.items.length) {
      // Já começa a baixar as miniaturas enquanto o JARVIS fala: quando a galeria abre, elas estão em cache.
      last.items.forEach(it => { getThumb(it.id).catch(() => {}); });
      return { ...last, query: q, used: v, relaxed: v !== q };
    }
  }
  return { ...last, query: q, used: q, relaxed: false };
}

async function searchOnce(q, { count = 12, safe = true } = {}) {
  prune();
  let provider = googleConfigured() ? 'google' : 'openverse', list = [], fallback = false;
  try { list = provider === 'google' ? await searchGoogle(q, count, safe) : await searchOpenverse(q, count, safe); }
  catch (e) {
    if (provider !== 'google') throw Object.assign(new Error('A busca de imagens não respondeu agora.'), { code: 502 });
    // Google falhou (cota, chave): segue com o Openverse para não deixar o usuário sem nada.
    provider = 'openverse'; fallback = true;
    try { list = await searchOpenverse(q, count, safe); } catch { throw Object.assign(new Error('A busca de imagens não respondeu agora.'), { code: 502 }); }
  }
  const items = [];
  for (const it of list) {
    const url = okUrl(it.url), thumb = okUrl(it.thumb) || url;
    if (!url) continue;
    const id = newId(url, thumb, clean(it.title) || q);
    const meta = { id, url, thumb, title: clean(it.title) || q, source: clean(it.source, 60), page: okUrl(it.page), width: +it.width || null, height: +it.height || null,
      license: clean(it.license, 40), creator: clean(it.creator, 60), query: q };
    reg.set(id, { ...meta, exp: Date.now() + TTL });
    items.push({ id, title: meta.title, source: meta.source, page: meta.page, width: meta.width, height: meta.height, license: meta.license, creator: meta.creator });
    if (items.length >= count) break;
  }
  return { query: q, provider, fallback, items };
}

/* ---------- Download seguro ---------- */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}
async function assertPublic(u) {
  const host = new URL(u).hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new Error('host local');
  const addrs = net.isIP(host) ? [{ address: host }] : await IMAGES.resolve(host, { all: true });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error('endereço privado');
}

async function fetchImage(url) {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(cur);
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const r = await fetch(cur, { redirect: 'manual', signal: ac.signal, headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', 'user-agent': 'Mozilla/5.0 (JARVIS local)' } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { cur = okUrl(new URL(r.headers.get('location'), cur).href); if (!cur) break; continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(type)) throw new Error('não é imagem');
      if (+r.headers.get('content-length') > MAX_BYTES) throw new Error('grande demais');
      const chunks = []; let size = 0;
      for await (const c of r.body) { size += c.length; if (size > MAX_BYTES) throw new Error('grande demais'); chunks.push(c); }
      return { type, buf: Buffer.concat(chunks) };
    } finally { clearTimeout(t); }
  }
  throw new Error('redirecionamentos demais');
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };
export const slug = s => String(s || 'imagem').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'imagem';
export function fileName(meta, type, i) { return `${i != null ? String(i + 1).padStart(2, '0') + '-' : ''}${slug(meta.title)}.${EXT[type] || 'img'}`; }

function entry(id) {
  prune();
  const m = reg.get(id) || unseal(id);
  if (!m) throw Object.assign(new Error('Essa imagem expirou. Faça a busca de novo.'), { code: 410 });
  return m;
}
export async function getThumb(id) {
  const m = entry(id);
  // Guarda a promessa: o pedido do navegador aproveita o download já em andamento (pré-carga após a busca).
  if (!thumbs.has(id)) {
    if (thumbs.size > 120) thumbs.delete(thumbs.keys().next().value);
    const p = (async () => {
      let out;
      try { out = await fetchImage(m.thumb); } catch { out = await fetchImage(m.url); }
      if (out.type === 'image/svg+xml') throw Object.assign(new Error('SVG não é exibido como miniatura.'), { code: 415 });
      return out;
    })();
    p.catch(() => thumbs.delete(id));
    thumbs.set(id, p);
  }
  return thumbs.get(id);
}
export async function getFull(id) {
  const m = entry(id);
  try { const out = await fetchImage(m.url); return { ...out, name: fileName(m, out.type) }; }
  catch (e) { throw Object.assign(new Error(`Não consegui baixar essa imagem (${e.message}). Tente outra.`), { code: 502 }); }
}

/* ---------- ZIP (sem compressão: imagens já são comprimidas) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zip(files) {
  const parts = [], central = []; let off = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), crc = crc32(f.buf), size = f.buf.length;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(size, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, f.buf);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(size, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(off, 42); central.push(c, name);
    off += 30 + name.length + size;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

export async function zipImages(ids) {
  const list = [...new Set(ids)].slice(0, 30), files = [], skipped = [], credits = [];
  await Promise.all(list.map(async (id, i) => {
    try { const m = entry(id), out = await fetchImage(m.url); files[i] = { name: fileName(m, out.type, i), buf: out.buf };
      credits[i] = `${fileName(m, out.type, i)}\n  título: ${m.title}\n  fonte: ${m.page || m.url}${m.creator ? `\n  autor: ${m.creator}` : ''}${m.license ? `\n  licença: ${m.license}` : ''}`; }
    catch { skipped.push(id); }
  }));
  const ok = files.filter(Boolean);
  if (!ok.length) throw Object.assign(new Error('Não consegui baixar nenhuma das imagens escolhidas.'), { code: 502 });
  const q = reg.get(list[0])?.query || 'imagens';
  ok.push({ name: 'CREDITOS.txt', buf: Buffer.from(`Imagens exportadas pelo JARVIS · busca: "${q}" · ${new Date().toLocaleString('pt-BR')}\nConfira a licença de cada imagem antes de publicar.\n\n${credits.filter(Boolean).join('\n\n')}\n`, 'utf8') });
  return { buf: zip(ok), name: `jarvis-${slug(q)}.zip`, count: ok.length - 1, skipped: skipped.length };
}

// Registra uma foto já conhecida (ex.: a imagem de uma notícia) para o app exibir por /api/images/<id>/file,
// com o mesmo download seguro das buscas (só endereços públicos).
export function registerUrl(url, { title = '', source = '', page = '' } = {}) {
  const u = okUrl(url); if (!u) return null;
  prune();
  const id = newId(u, u, clean(title) || 'foto');
  reg.set(id, { id, url: u, thumb: u, title: clean(title) || 'foto', source: clean(source, 60), page: okUrl(page), width: null, height: null, license: '', creator: '', query: '', exp: Date.now() + TTL });
  return { id, title: clean(title) || 'foto', source: clean(source, 60), page: okUrl(page) };
}
