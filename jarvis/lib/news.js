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

// Notícias sobre um assunto ("notícias sobre a Copa"): busca dos últimos 2 dias.
export async function searchNews(profile, q, max = 5) {
  const L = LANG[profile?.lang] || LANG['pt-BR'];
  const top = await feed('/search', { q: `${q} when:2d`, ...L }, max);
  if (!top.length) throw new Error('notícias indisponíveis');
  return { top, local: [], city: '', at: new Date().toISOString(), source: 'Google Notícias', topic: q };
}

// Palavra em destaque do jornal (fica amarela no meio da montagem): o assunto pedido ou o nome próprio mais forte da manchete.
const NAO = new Set(['Após', 'Apos', 'Como', 'Para', 'Pela', 'Pelo', 'Sobre', 'Entre', 'Quando', 'Mais', 'Novo', 'Nova', 'Veja', 'Saiba', 'Entenda', 'Governo', 'Brasil']);
export function keyword(n) {
  if (n.topic) return (n.topic.length <= 18 ? n.topic : n.topic.split(/\s+/).sort((a, b) => b.length - a.length)[0]).toUpperCase().slice(0, 18);
  const t = n.top[0]?.title || '';
  const caps = t.split(/\s+/).slice(1).map(w => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter(w => /^\p{Lu}/u.test(w) && w.length >= 4 && !NAO.has(w));
  return (caps.sort((a, b) => b.length - a.length)[0] || 'NOTÍCIAS').toUpperCase().slice(0, 14);
}
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); if (!Number.isFinite(m) || m < 0) return ''; return m < 60 ? `há ${Math.max(1, m)} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`; };
const pick = (arr, i) => arr[i % arr.length];

// Apresentação em formato de jornal, montada sem IA (rápida): montagem de abertura, capa e uma página por notícia.
// A narração usa frases prontas no tom do JARVIS; as fotos entram depois (servidor), pela manchete.
export function jornalDeck(n, a) {
  const items = [...n.top, ...n.local].slice(0, 5), palavra = keyword(n);
  const sub = n.topic ? `sobre ${n.topic}` : 'de agora';
  const ABRE = [`Edição extra, ${a.short}. As manchetes ${sub}, antes que fiquem velhas.`, `Parem as máquinas, ${a.short}. Separei as notícias ${sub}.`, `Rodando a impressora, ${a.short}. Eis o que está acontecendo ${n.topic ? `com ${n.topic}` : 'por aí'}.`];
  const LIGA = ['', 'Em seguida: ', 'Também na pauta: ', 'Enquanto isso: ', 'E ainda: '];
  const FONTE = s => s ? pick([`Quem conta é ${s}.`, `A informação é de ${s}.`, `Segundo ${s}.`], s.length) : '';
  const slides = [
    { title: palavra, layout: 'jornal-intro', jornal: { palavra }, narration: pick(ABRE, items.length + new Date().getMinutes()) },
    { title: n.topic ? `Notícias: ${n.topic}` : 'Capa de hoje', layout: 'jornal-capa', jornal: { palavra, at: n.at, items: items.map(x => ({ title: x.title, source: x.source, ago: ago(x.at), local: !!x.local })) },
      image: items[0] ? items[0].title.split(/\s+/).slice(0, 7).join(' ') : '',
      narration: `Na capa: ${items.slice(0, 3).map(x => x.title.replace(/[.;:]+$/, '')).join('; ')}.` },
    ...items.map((x, i) => ({ title: x.title, layout: 'jornal', image: x.title.split(/\s+/).slice(0, 7).join(' '),
      jornal: { palavra, source: x.source, ago: ago(x.at), local: !!x.local, n: i + 1, total: items.length, link: x.link },
      narration: `${pick(LIGA, i)}${x.title.replace(/[.;:]+$/, '')}. ${FONTE(x.source)}`.trim() }))
  ];
  return { topic: n.topic ? `Jornal · ${n.topic}` : 'Jornal do Jarvis', intro: '', chart: null, slides,
    outro: pick([`É o que temos, ${a.short}. O resto é opinião.`, `Fim da edição, ${a.short}. Quer que eu aprofunde alguma?`, `Jornal fechado, ${a.short}. Peça mais detalhes de qualquer manchete.`], items.length), remember: [] };
}

// Foto da notícia: o Bing Notícias (RSS, sem chave) traz a miniatura da própria matéria; pedimos em tamanho maior.
export async function newsImage(title, lang = 'pt-BR') {
  const q = String(title || '').split(/\s+/).slice(0, 9).join(' ');
  if (!q) return null;
  const cc = { 'pt-BR': 'BR', 'en-US': 'US', 'es-ES': 'ES' }[lang] || 'BR';
  const u = `https://www.bing.com/news/search?${new URLSearchParams({ q, format: 'rss', setlang: lang, cc })}`;
  const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (JARVIS local)' }, signal: AbortSignal.timeout(4000) });
  if (!r.ok) return null;
  const m = (await r.text()).match(/<News:Image>([^<]+)<\/News:Image>/i);
  if (!m) return null;
  const img = decodeEntities(m[1]).replace(/^http:/, 'https:');
  return /^https:\/\/www\.bing\.com\/th\?id=/.test(img) ? `${img}&w=960&h=540&c=14&rs=2` : null;
}
