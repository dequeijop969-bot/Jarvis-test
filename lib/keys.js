// Chaves de API próprias. Guardadas só em data/keys.local.json (600); o .env vale como alternativa.
// Nada aqui sai do servidor sem máscara.
import { readJSON, writeJSON } from './store.js';
import { registerSecret, forgetSecret, mask } from './secrets.js';

const FILE = 'keys.local.json';
export const PROVIDERS = {
  gemini: { label: 'Gemini', env: 'GEMINI_API_KEY' },
  anthropic: { label: 'Anthropic', env: 'ANTHROPIC_API_KEY' },
  elevenlabs: { label: 'ElevenLabs', env: 'ELEVENLABS_API_KEY', voiceEnv: 'ELEVENLABS_VOICE_ID' },
  // GitHub: dois tokens de ESCOPO FINO (fine-grained), separados. Nada de token clássico nem OAuth App com "repo".
  github_read: { label: 'GitHub (leitura)', env: 'GITHUB_TOKEN_READ', github: true },
  github_write: { label: 'GitHub (escrita)', env: 'GITHUB_TOKEN_WRITE', github: true }
};

let cache = null;
const load = () => (cache ??= readJSON(FILE, {}));
const save = () => writeJSON(FILE, cache);
const tests = {}; // último resultado de "Testar", só em memória

export function getKey(p) {
  const v = load()[p]?.key || process.env[PROVIDERS[p]?.env] || '';
  registerSecret(v);
  return v;
}
export function getVoiceId() {
  return load().elevenlabs?.voice_id || process.env.ELEVENLABS_VOICE_ID || '';
}
export const hasKey = p => !!getKey(p);

// Todas as chaves ElevenLabs, na ordem de uso (fallback). O 1º slot é a chave salva pela interface ou
// ELEVENLABS_API_KEY; depois vêm ELEVENLABS_API_KEY_2, _3, _4... Cada slot pode ter voz própria
// (ELEVENLABS_VOICE_ID_2...); se não tiver, usa a voz do 1º slot.
export function getElevenSlots() {
  const slots = [], seen = new Set();
  const add = (key, voice, n) => {
    key = (key || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key); registerSecret(key);
    slots.push({ key, voice: (voice || '').trim() || getVoiceId(), n });
  };
  add(getKey('elevenlabs'), getVoiceId(), 1);
  for (let n = 2; n <= 10; n++) add(process.env[`ELEVENLABS_API_KEY_${n}`], process.env[`ELEVENLABS_VOICE_ID_${n}`], n);
  return slots;
}

const KEY_RE = /^[\x21-\x7e]{10,300}$/;      // ASCII visível, sem espaços
const VOICE_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function setKey(p, { key, voice_id } = {}) {
  if (!PROVIDERS[p]) throw Object.assign(new Error('Provedor desconhecido.'), { code: 404 });
  const k = typeof key === 'string' ? key.trim() : '';
  const cur = load()[p] || {};
  if (k && !KEY_RE.test(k)) throw Object.assign(new Error('Formato de chave inválido.'), { code: 400 });
  if (k && PROVIDERS[p].github && !/^github_pat_[A-Za-z0-9_]{20,}$/.test(k))
    throw Object.assign(new Error('Use um token de escopo fino (começa com github_pat_). Tokens clássicos e de OAuth App não são aceitos.'), { code: 400 });
  if (!k && !cur.key && !(p === 'elevenlabs' && voice_id)) throw Object.assign(new Error('Cole a chave antes de salvar.'), { code: 400 });
  const next = { ...cur };
  if (k) { if (cur.key) forgetSecret(cur.key); next.key = k; registerSecret(k); }
  if (p === 'elevenlabs' && typeof voice_id === 'string' && voice_id.trim()) {
    if (!VOICE_RE.test(voice_id.trim())) throw Object.assign(new Error('ID da voz inválido.'), { code: 400 });
    next.voice_id = voice_id.trim();
  }
  next.updated_at = new Date().toISOString();
  cache = { ...load(), [p]: next };
  delete tests[p];
  save();
  return status(p);
}

export function deleteKey(p) {
  if (!PROVIDERS[p]) throw Object.assign(new Error('Provedor desconhecido.'), { code: 404 });
  const cur = load()[p];
  if (cur?.key) forgetSecret(cur.key);
  cache = { ...load() }; delete cache[p]; delete tests[p];
  save();
  return status(p);
}

export function status(p) {
  const local = load()[p] || {}, envKey = process.env[PROVIDERS[p].env];
  const key = local.key || envKey || '';
  const out = {
    provider: p, label: PROVIDERS[p].label,
    configured: !!key, source: local.key ? 'local' : envKey ? 'env' : null,
    masked: mask(key), test: tests[p] || null
  };
  if (p === 'elevenlabs') { const v = getVoiceId(); out.voice_masked = mask(v); if (key && !v) out.configured = false; }
  out.state = !out.configured ? 'off' : tests[p]?.ok === false ? 'error' : 'on';
  return out;
}
export const allStatus = () => Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, status(p)]));
export const lastTest = p => tests[p] || null;

const TEST_MSG = {
  400: 'A chave foi recusada (formato inválido).', 401: 'Chave inválida.', 403: 'Acesso negado para esta chave.',
  404: 'Não encontrado (confira o ID da voz).', 429: 'Limite de uso atingido; a chave parece válida.'
};
// Chamada mínima e barata para validar. Nunca devolve a chave nem o corpo da resposta.
export async function testKey(p) {
  if (!PROVIDERS[p]) throw Object.assign(new Error('Provedor desconhecido.'), { code: 404 });
  const key = getKey(p);
  let result;
  if (!key) result = { ok: false, message: 'Nenhuma chave salva.' };
  else if (PROVIDERS[p].github) {
    // Mostra login e permissões efetivas (por sondagem segura) e avisa se houver poder demais.
    const { testToken } = await import('./github.js');
    result = await testToken(p === 'github_write' ? 'write' : 'read');
  }
  else {
    let url, headers;
    if (p === 'gemini') { url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'; headers = { 'x-goog-api-key': key }; }
    if (p === 'anthropic') { url = 'https://api.anthropic.com/v1/models?limit=1'; headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' }; }
    if (p === 'elevenlabs') {
      const v = getVoiceId();
      if (!v) result = { ok: false, message: 'Falta o ID da voz.' };
      url = `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(v)}`; headers = { 'xi-api-key': key };
    }
    if (!result) {
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
        result = r.ok ? { ok: true, message: 'Funcionando.' } : { ok: false, message: TEST_MSG[r.status] || `O serviço respondeu com erro ${r.status}.` };
      } catch { result = { ok: false, message: 'Sem conexão com o serviço.' }; }
    }
  }
  tests[p] = { ...result, at: new Date().toISOString() };
  return status(p);
}
export const _resetForTests = () => { cache = null; for (const k in tests) delete tests[k]; };
