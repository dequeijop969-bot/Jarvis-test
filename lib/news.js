// Notícias recentes via RSS público do Google Notícias (sem chave). Só manchete, fonte, link e horário.
import { decodeEntities } from './google.js';

const LANG = {
  'pt-BR': { hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' },
  'en-US': { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  'es-ES': { hl: 'es', gl: 'ES', ceid: 'ES:es' }
};
const cache = new Map(); // 20 minutos
const TTL = 20 * 60_000;
export const _clearNewsCache = () => cache.clear();

const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : ''; };
const clean = s => decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).replace(/[\x01-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();

export function parseRss(xml, max = 6) {
  const items = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const seen = new Set();
  return items.map(it => {
    let title = clean(tag(it, 'title')), source = clean(tag(it, 'source'));
    // O Google põe " - Fonte" no fim do título.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = clean(tag(it, 'link')), at = Date.parse(clean(tag(it, 'pubDate')));
    return { title: title.slice(0, 160), source: source.slice(0, 60), link: /^https:\/\//.test(link) ? link : '', at: Number.isFinite(at) ? new Date(at).toISOString() : null };
  }).filter(n => n.title && !seen.has(n.title.toLowerCase()) && seen.add(n.title.toLowerCase())).slice(0, max);
}

async function feed(path, params, max) {
  const u = new URL(`https://news.google.com/rss${path}`);
  u.search = new URLSearchParams(params);
  const k = u.toString(), hit = cache.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (JARVIS local)' }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('notícias indisponíveis');
  const v = parseRss(await r.text(), max);
  cache.set(k, { v, exp: Date.now() + TTL });
  return v;
}

// Manchetes do país + até 2 da cidade do perfil (se houver). Falha de uma parte não derruba a outra.
export async function headlines(profile) {
  const L = LANG[profile?.lang] || LANG['pt-BR'];
  const city = profile?.city?.name;
  const [top, local] = await Promise.all([
    feed('', L, 5).catch(() => []),
    city ? feed('/search', { q: `"${city}" when:2d`, ...L }, 3).catch(() => []) : Promise.resolve([])
  ]);
  const titles = new Set(top.map(n => n.title.toLowerCase()));
  const loc = local.filter(n => !titles.has(n.title.toLowerCase())).slice(0, 2).map(n => ({ ...n, local: true }));
  if (!top.length && !loc.length) throw new Error('notícias indisponíveis');
  return { top, local: loc, city: city || '', at: new Date().toISOString(), source: 'Google Notícias' };
}

const join = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join('; ')}; e ${a.at(-1)}`;
export function newsSpeech(n) {
  if (!n || (!n.top?.length && !n.local?.length)) return '';
  const bits = [];
  if (n.top.length) bits.push(`Nas manchetes, ${join(n.top.slice(0, 3).map(x => x.title.replace(/[.;]+$/, '')))}.`);
  if (n.local.length) bits.push(`E por aqui, em ${n.city}: ${n.local[0].title.replace(/[.;]+$/, '')}.`);
  return bits.join(' ');
}
