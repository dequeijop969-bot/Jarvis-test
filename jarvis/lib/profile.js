// Perfil do usuário em data/profile.json (ignorado pelo .gitignore).
import { readJSON, writeJSON } from './store.js';

const FILE = 'profile.json';
const ADDRESS = new Set(['senhor', 'senhora', 'neutro']);
const LANGS = new Set(['pt-BR', 'en-US', 'es-ES']);
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, n) : '');

export const getProfile = () => readJSON(FILE, null);
export const isComplete = p => !!(p && p.name && ADDRESS.has(p.address) && p.city?.name);

export function saveProfile(input, current = getProfile()) {
  const p = cleanProfile(input, current);
  writeJSON(FILE, p);
  return p;
}
// Confere e aplica o pedido sobre o perfil atual, sem gravar.
export function cleanProfile(input, current) {
  const p = { ...(current || {}) };
  if ('name' in input) { const n = str(input.name, 60); if (!n) throw Object.assign(new Error('Diga seu nome.'), { code: 400 }); p.name = n; }
  if ('address' in input) { if (!ADDRESS.has(input.address)) throw Object.assign(new Error('Forma de tratamento inválida.'), { code: 400 }); p.address = input.address; }
  if ('lang' in input) p.lang = LANGS.has(input.lang) ? input.lang : 'pt-BR';
  if ('city' in input) {
    const c = input.city || {};
    const lat = Number(c.latitude), lon = Number(c.longitude);
    if (!str(c.name, 80) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      throw Object.assign(new Error('Escolha a cidade na lista.'), { code: 400 });
    const tz = str(c.timezone, 60);
    p.city = { name: str(c.name, 80), admin1: str(c.admin1, 80), country: str(c.country, 80), country_code: str(c.country_code, 2).toUpperCase(),
      latitude: lat, longitude: lon, timezone: /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz) ? tz : 'auto' };
  }
  if ('level' in input) p.level = ['1.0', '2.5', '5.1'].includes(input.level) ? input.level : p.level;
  if ('voice' in input) {
    const v = input.voice || {}, cur = p.voice || {};
    p.voice = {
      provider: ['auto', 'edge', 'elevenlabs', 'browser'].includes(v.provider) ? v.provider : cur.provider || 'auto',
      edgeVoice: /^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(v.edgeVoice || '') ? v.edgeVoice : cur.edgeVoice || '',
      rate: Number.isFinite(+v.rate) && v.rate !== '' && v.rate != null ? Math.max(-25, Math.min(25, Math.round(+v.rate))) : cur.rate ?? -6,
      pitch: Number.isFinite(+v.pitch) && v.pitch !== '' && v.pitch != null ? Math.max(-25, Math.min(15, Math.round(+v.pitch))) : cur.pitch ?? -8
    };
  }
  // "Sobre você" (Ajustes > Perfil): o Jarvis usa nas respostas. Tudo opcional, tudo curto.
  if ('about' in input) {
    // Listas só de textos/números: objetos e null viravam "[object Object]" e "null" no perfil (e no prompt da IA).
    const ab = input.about && typeof input.about === 'object' && !Array.isArray(input.about) ? input.about : {};
    const list = (v, n) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]/) : []).filter(x => typeof x === 'string' || typeof x === 'number').map(x => str(String(x), 40)).filter(Boolean).slice(0, n);
    const hour = v => { const h = Number(v); return Number.isInteger(h) && h >= 0 && h <= 24 ? h : null; };
    p.about = {
      trabalho: str(ab.trabalho, 100), ferramentas: list(ab.ferramentas, 12), interesses: list(ab.interesses, 10),
      inicio: hour(ab.inicio), fim: hour(ab.fim),
      estilo: ['curto', 'equilibrado', 'detalhado'].includes(ab.estilo) ? ab.estilo : 'equilibrado',
      sarcasmo: ['leve', 'padrao', 'maximo'].includes(ab.sarcasmo) ? ab.sarcasmo : 'padrao',
      notas: str(ab.notas, 400)
    };
    if (p.about.inicio != null && p.about.fim != null && p.about.fim <= p.about.inicio) { p.about.inicio = null; p.about.fim = null; }
  }
  if ('whatsapp' in input) { const d = String(input.whatsapp || '').replace(/\D/g, ''); p.whatsapp = d.length >= 10 && d.length <= 15 ? d : ''; }
  if ('launcher' in input) p.launcher = input.launcher !== false;
  if ('mode' in input) p.mode = input.mode === 'code' ? 'code' : 'talk';   // Talk (conversa) ou Code (ações no PC)
  if ('gmailInvite' in input && ['pending', 'skipped', 'reminded', 'connected'].includes(input.gmailInvite)) p.gmailInvite = input.gmailInvite;
  p.lang ||= 'pt-BR';
  p.gmailInvite ||= 'pending';
  p.createdAt ||= new Date().toISOString();
  p.updatedAt = new Date().toISOString();
  return p;
}

// Formas de tratamento usadas na fala.
export function addressing(p) {
  const first = (p?.name || '').split(/\s+/)[0] || '';
  const a = p?.address || 'senhor';
  if (a === 'neutro') return { vocative: first || 'você', short: first || 'você', subject: 'você', Subject: 'Você', obj: 'você', rule: `Trate o usuário pelo nome (${first || 'sem nome'}), sem "senhor" ou "senhora"; use "você".` };
  const art = a === 'senhor' ? 'o' : 'a';
  return {
    vocative: first ? `${a} ${first}` : a, short: a, subject: `${art} ${a}`, Subject: `${art.toUpperCase()} ${a}`, obj: `${art} ${a}`,
    rule: `Chame o usuário de "${a}" (ex.: "sim, ${a}"; "${art} ${a} tem..."). Nome: ${first || 'não informado'}.`
  };
}

export function greetingWord(timezone) {
  let h;
  try { h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone && timezone !== 'auto' ? timezone : undefined }).format(new Date())); }
  catch { h = new Date().getHours(); }
  return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
}
