// Perfil do usuário em data/profile.json (ignorado pelo .gitignore).
import { readJSON, writeJSON } from './store.js';

const FILE = 'profile.json';
const ADDRESS = new Set(['senhor', 'senhora', 'neutro']);
const LANGS = new Set(['pt-BR', 'en-US', 'es-ES']);
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, n) : '');

export function getProfile() {
  const p = readJSON(FILE, null);
  if (p || !process.env.JARVIS_PROFILE) return p;
  // Hospedado: o disco é apagado quando a função dorme. JARVIS_PROFILE (JSON) recria o perfil sem refazer o formulário.
  try { return saveProfile(JSON.parse(process.env.JARVIS_PROFILE), {}); } catch { return null; }
}
export const isComplete = p => !!(p && p.name && ADDRESS.has(p.address) && p.city?.name);

export function saveProfile(input, current = getProfile()) {
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
  if ('gmailInvite' in input && ['pending', 'skipped', 'reminded', 'connected'].includes(input.gmailInvite)) p.gmailInvite = input.gmailInvite;
  p.lang ||= 'pt-BR';
  p.gmailInvite ||= 'pending';
  p.createdAt ||= new Date().toISOString();
  p.updatedAt = new Date().toISOString();
  writeJSON(FILE, p);
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
