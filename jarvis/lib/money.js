// Câmbio e cripto pela AwesomeAPI (economia.awesomeapi.com.br, sem chave): cotação de agora, variação do dia e os
// últimos 7 dias para o gráfico. "quanto está o dólar", "cotação do euro", "preço do bitcoin", "converte 100 dólares".
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s.,]/g, ' ').replace(/\s+/g, ' ').trim();
export const COINS = {
  USD: { name: 'Dólar', rx: /\bdolar(es)?\b|\bdollar\b|\busd\b/, crypto: false },
  EUR: { name: 'Euro', rx: /\beuros?\b|\beur\b/, crypto: false },
  GBP: { name: 'Libra', rx: /\blibras?( esterlinas?)?\b|\bgbp\b/, crypto: false },
  ARS: { name: 'Peso argentino', rx: /\bpesos? argentinos?\b/, crypto: false },
  JPY: { name: 'Iene', rx: /\bienes?\b|\byen\b/, crypto: false },
  CAD: { name: 'Dólar canadense', rx: /\bdolar(es)? canadense(s)?\b/, crypto: false },
  BTC: { name: 'Bitcoin', rx: /\bbitcoins?\b|\bbtc\b/, crypto: true },
  ETH: { name: 'Ethereum', rx: /\bethereum\b|\bether\b|\beth\b/, crypto: true },
  SOL: { name: 'Solana', rx: /\bsolana\b/, crypto: true },
  XRP: { name: 'XRP', rx: /\bxrp\b|\bripple\b/, crypto: true },
  DOGE: { name: 'Dogecoin', rx: /\bdoge(coin)?\b/, crypto: true }
};
// Entende o pedido: { op:'cotacao', codes } | { op:'converter', amount, code } | null
export function parse(text) {
  const t = fold(text);
  if (!/\b(cotacao|cotacoes|quanto (esta|ta|custa|vale|ta valendo|esta valendo)|preco|valor|vale|converte|converter|conversao|em reais|fechou|subiu|caiu|como (esta|ta) o|como (estao|tao) (as|os)|cambio)\b/.test(t)) return null;
  let codes = Object.keys(COINS).filter(k => COINS[k].rx.test(t));
  if (codes.includes('CAD')) codes = codes.filter(c => c !== 'USD');
  if (/\b(cripto|criptomoedas?|moedas digitais)\b/.test(t) && !codes.length) codes = ['BTC', 'ETH', 'SOL'];
  if (/\b(cambio|moedas|cotacoes)\b/.test(t) && !codes.length) codes = ['USD', 'EUR', 'BTC'];
  if (!codes.length) return null;
  const amt = t.match(/\b(\d+(?:[.,]\d+)?)\s*(mil )?(dolar|dolares|euros?|libras?|bitcoins?|btc|ethereum|eth|reais|real)\b/);
  if (amt && /\b(converte|converter|conversao|quanto (e|da|sao|fica)|em reais)\b/.test(t)) {
    let n = Number(amt[1].replace(',', '.')) * (amt[2] ? 1000 : 1);
    if (/reais|real/.test(amt[3])) return { op: 'converter', amount: n, code: codes[0], toForeign: true };
    return { op: 'converter', amount: n, code: codes[0] };
  }
  return { op: 'cotacao', codes: codes.slice(0, 4) };
}

const get = async u => { const r = await fetch(u, { headers: { 'user-agent': 'JARVIS local' }, signal: AbortSignal.timeout(6000) }); if (!r.ok) throw new Error('cotações indisponíveis'); return r.json(); };
const cache = new Map();
async function cached(k, f, ttl = 60_000) { const h = cache.get(k); if (h && h.exp > Date.now()) return h.v; const v = await f(); cache.set(k, { v, exp: Date.now() + ttl }); return v; }

export async function quotes(codes) {
  const j = await cached('last:' + codes.join(), () => get(`https://economia.awesomeapi.com.br/json/last/${codes.map(c => `${c}-BRL`).join(',')}`));
  return codes.map(c => { const q = j[`${c}BRL`]; if (!q) return null; return { code: c, name: COINS[c].name, bid: Number(q.bid), pct: Number(q.pctChange), high: Number(q.high), low: Number(q.low), at: Number(q.timestamp) * 1000 }; }).filter(Boolean);
}
export async function history(code, days = 7) {
  const j = await cached(`hist:${code}:${days}`, () => get(`https://economia.awesomeapi.com.br/json/daily/${code}-BRL/${days}`), 10 * 60_000);
  return (Array.isArray(j) ? j : []).map(d => ({ at: Number(d.timestamp) * 1000, v: Number(d.bid) })).filter(d => d.v).reverse();
}
export const brl = (v, crypto) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: crypto ? 0 : 2, maximumFractionDigits: crypto ? 0 : v < 1 ? 4 : 2 });
// "cinco reais e quarenta e quatro centavos" fica comprido; o JARVIS fala "R$ 5,44" como "5 reais e 44"
export function spoken(v, crypto) {
  if (crypto || v >= 1000) return `${Math.round(v).toLocaleString('pt-BR')} reais`;
  const r = Math.floor(v), c = Math.round((v - r) * 100);
  return c ? `${r} rea${r === 1 ? 'l' : 'is'} e ${c} centavos` : `${r} rea${r === 1 ? 'l' : 'is'}`;
}
// "100 dólares", "1 euro", "2 bitcoins"
const PLURAL = { USD: 'dólares', EUR: 'euros', GBP: 'libras', ARS: 'pesos argentinos', JPY: 'ienes', CAD: 'dólares canadenses', BTC: 'bitcoins', ETH: 'ethereums', SOL: 'solanas', XRP: 'XRP', DOGE: 'dogecoins' };
export const unitName = (code, n) => n === 1 ? COINS[code].name.toLowerCase() : PLURAL[code] || COINS[code].name.toLowerCase();
