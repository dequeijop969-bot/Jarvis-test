// Futebol pela API pública da ESPN (sem chave): último resultado, jogo ao vivo, próximo jogo e a tabela do Brasileirão
// (Séries A e B). Entende o nome do time e apelidos ("Timão", "Verdão", "Mengão", "Galo"...).
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LEAGUES = { 'bra.1': 'Brasileirão Série A', 'bra.2': 'Brasileirão Série B' };
const NICK = { timao: 'corinthians', verdao: 'palmeiras', porco: 'palmeiras', mengao: 'flamengo', urubu: 'flamengo', galo: 'atletico-mg', peixe: 'santos', fogao: 'botafogo',
  colorado: 'internacional', inter: 'internacional', raposa: 'cruzeiro', furacao: 'athletico-pr', 'sao paulo': 'sao paulo', spfc: 'sao paulo', tricolor: 'sao paulo', vascao: 'vasco',
  'atletico mineiro': 'atletico-mg', 'atletico paranaense': 'athletico-pr', fluzao: 'fluminense', imortal: 'gremio', leao: 'fortaleza', vozao: 'ceara', 'bragantino': 'red bull bragantino' };

const get = async u => { const r = await fetch(u, { headers: { 'user-agent': 'JARVIS local' }, signal: AbortSignal.timeout(7000) }); if (!r.ok) throw new Error('futebol indisponível'); return r.json(); };
const cache = new Map();
async function cached(k, f, ttl) { const h = cache.get(k); if (h && h.exp > Date.now()) return h.v; const v = await f(); cache.set(k, { v, exp: Date.now() + ttl }); return v; }

async function teams() {
  return cached('teams', async () => {
    const out = [];
    for (const lg of Object.keys(LEAGUES)) {
      try {
        const j = await get(`${BASE}/${lg}/teams`);
        for (const { team: t } of j.sports?.[0]?.leagues?.[0]?.teams || []) out.push({ id: t.id, league: lg, name: t.displayName, short: t.shortDisplayName, abbr: t.abbreviation, logo: t.logos?.[0]?.href || '' });
      } catch { /* uma série fora do ar não derruba a outra */ }
    }
    return out;
  }, 24 * 3600_000);
}
// O time citado no texto (nome, nome curto, sigla ou apelido).
export async function findTeam(text) {
  let t = ` ${fold(text)} `;
  for (const [k, v] of Object.entries(NICK)) if (t.includes(` ${k} `)) t += ` ${v} `;
  const list = await teams();
  let best = null, score = 0;
  for (const x of list) {
    for (const cand of [x.name, x.short]) {
      const c = fold(cand).replace(/-/g, ' '), tt = t.replace(/-/g, ' ');
      if (c.length >= 4 && tt.includes(` ${c} `) && c.length > score) { best = x; score = c.length; }
      const first = c.split(' ')[0];   // "Atlético-MG" → "atletico mg": aceita "atletico mg" e o nome sem sufixo se único
      if (first.length >= 5 && tt.includes(` ${first} `) && first.length > score && list.filter(y => fold(y.name).startsWith(first)).length === 1) { best = x; score = first.length; }
    }
  }
  return best;
}

const STATUS = s => {
  const n = s?.type?.name || '';
  if (/IN_PROGRESS|HALFTIME|FIRST_HALF|SECOND_HALF/.test(n)) return { live: true, label: n.includes('HALFTIME') ? 'Intervalo' : `Ao vivo · ${s.displayClock || ''}`.trim() };
  if (s?.type?.completed) return { done: true, label: 'Encerrado' };
  return { label: 'Agendado' };
};
function match(e) {
  const c = e.competitions?.[0] || {}, st = STATUS(c.status);
  const side = h => { const x = (c.competitors || []).find(k => k.homeAway === h) || {}; return { id: x.team?.id, name: x.team?.shortDisplayName || x.team?.displayName || '', abbr: x.team?.abbreviation || '', logo: x.team?.logos?.[0]?.href || x.team?.logo || '', score: x.score?.displayValue ?? (typeof x.score === 'string' ? x.score : '') }; };
  return { date: e.date, venue: c.venue?.fullName || '', home: side('home'), away: side('away'), ...st, comp: e.season?.displayName || '' };
}
// Último jogo (ou o que está rolando agora) e o próximo.
export async function teamInfo(team) {
  const [sch, fix] = await Promise.all([
    cached(`sch:${team.id}`, () => get(`${BASE}/${team.league}/teams/${team.id}/schedule`), 5 * 60_000),
    cached(`fix:${team.id}`, () => get(`${BASE}/${team.league}/teams/${team.id}/schedule?fixture=true`), 5 * 60_000).catch(() => ({ events: [] }))
  ]);
  const all = [...(sch.events || []), ...(fix.events || [])].sort((a, b) => a.date.localeCompare(b.date)).map(match);
  const live = all.find(m => m.live), last = all.filter(m => m.done).pop() || null, next = all.find(m => !m.done && !m.live && Date.parse(m.date) > Date.now()) || null;
  const recent = all.filter(m => m.done).slice(-5);
  return { team, league: LEAGUES[team.league], live, last, next, recent };
}
export async function table(league = 'bra.1') {
  const j = await cached(`tab:${league}`, () => get(`https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings`), 10 * 60_000);
  const entries = j.children?.[0]?.standings?.entries || [];
  const stat = (e, n) => Number((e.stats || []).find(s => s.name === n)?.value ?? 0);
  return entries.map(e => ({ team: e.team?.shortDisplayName || e.team?.displayName, abbr: e.team?.abbreviation, logo: e.team?.logos?.[0]?.href || '', pts: stat(e, 'points'), j: stat(e, 'gamesPlayed'),
    v: stat(e, 'wins'), e: stat(e, 'ties'), d: stat(e, 'losses'), sg: stat(e, 'pointDifferential'), pos: stat(e, 'rank') }))
    .sort((a, b) => (a.pos || 99) - (b.pos || 99) || b.pts - a.pts).map((x, i) => ({ ...x, pos: x.pos || i + 1 }));
}
export const leagueName = lg => LEAGUES[lg] || 'Brasileirão';
export function when(iso) {
  const d = new Date(iso), now = new Date(), day = 86400_000;
  const diff = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / day);
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':00', 'h').replace(':', 'h');
  const dd = diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : diff === -1 ? 'ontem' : diff > 1 && diff < 7 ? d.toLocaleDateString('pt-BR', { weekday: 'long' }) : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  return `${dd} às ${hm}`;
}
