// Roteador de provedores: uma camada única para chamar o modelo do nível escolhido.
// 429/5xx: até 3 tentativas com espera exponencial; depois plano B (mesmo provedor) e, por fim, a reserva.
import crypto from 'node:crypto';
import { getKey } from './keys.js';
import { log } from './secrets.js';

export class ProviderError extends Error {
  constructor(provider, status, msg, retryAfter) {
    super(msg || `${provider} falhou (${status})`);
    this.provider = provider; this.status = status; this.retryAfter = retryAfter;
    this.retryable = status === 429 || status >= 500 || status === 0;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const ROUTER = { baseDelay: 600, maxAttempts: 3 }; // ajustável nos testes

const b64 = d => String(d).replace(/^data:image\/jpeg;base64,/, '');
async function callGemini(t, { system, messages, json, maxTokens }) {
  const key = getKey('gemini');
  if (!key) throw new ProviderError('gemini', -1, 'Sem chave do Gemini.');
  const generationConfig = { maxOutputTokens: maxTokens || 8192 };
  if (t.reasoning) generationConfig.thinkingConfig = { thinkingLevel: t.reasoning };
  if (json) generationConfig.responseMimeType = 'application/json';
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(t.model)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }, ...(m.image ? [{ inlineData: { mimeType: 'image/jpeg', data: b64(m.image) } }] : [])] })),
        generationConfig
      })
    });
  } catch { throw new ProviderError('gemini', 0, 'Sem conexão com o Gemini.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ProviderError('gemini', r.status, null, Number(r.headers.get('retry-after')) || 0);
  const parts = j.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!text) throw new ProviderError('gemini', 502, 'Resposta vazia do Gemini.');
  return text;
}

async function callAnthropic(t, { system, messages, maxTokens }) {
  const key = getKey('anthropic');
  if (!key) throw new ProviderError('anthropic', -1, 'Sem chave da Anthropic.');
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: t.model, max_tokens: maxTokens || 4000, system, messages: messages.map(m => m.image ? { role: m.role, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(m.image) } }, { type: 'text', text: m.content }] } : m) })
    });
  } catch { throw new ProviderError('anthropic', 0, 'Sem conexão com a Anthropic.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ProviderError('anthropic', r.status, null, Number(r.headers.get('retry-after')) || 0);
  if (j.stop_reason === 'refusal') throw new ProviderError('anthropic', 422, 'A Anthropic recusou o pedido.');
  const text = (j.content || []).map(c => c.type === 'text' ? c.text : '').join('').trim();
  if (!text) throw new ProviderError('anthropic', 502, 'Resposta vazia da Anthropic.');
  return text;
}
const CALL = { gemini: callGemini, anthropic: callAnthropic };

export function parseJSONLoose(t) {
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('fora do formato');
  return JSON.parse(t.slice(a, b + 1));
}

// Cache curto em memória para pedidos idênticos.
const cache = new Map();
const cacheGet = k => { const e = cache.get(k); if (e && e.exp > Date.now()) return e.v; cache.delete(k); return null; };
const cacheSet = (k, v, ttl) => { cache.set(k, { v, exp: Date.now() + ttl }); if (cache.size > 200) cache.delete(cache.keys().next().value); };
export const clearRouterCache = () => cache.clear();

async function withRetry(t, req) {
  let last;
  for (let a = 0; a < ROUTER.maxAttempts; a++) {
    try { return await CALL[t.provider](t, req); }
    catch (e) {
      last = e;
      if (!(e instanceof ProviderError) || !e.retryable || a === ROUTER.maxAttempts - 1) throw e;
      const wait = Math.min(4000, e.retryAfter ? e.retryAfter * 1000 : ROUTER.baseDelay * 2 ** a) + Math.random() * 120;
      log.warn(`[router] ${t.provider}/${t.model}: erro ${e.status}, nova tentativa em ${Math.round(wait)} ms`);
      await sleep(wait);
    }
  }
  throw last;
}

/**
 * Gera uma resposta. validate(obj) deve devolver o objeto limpo ou lançar erro.
 * Retorna { data, text, meta: { provider, model, tier, degraded } }.
 * data é null quando o JSON veio inválido duas vezes (o chamador usa o texto simples).
 */
export async function generate(models, levelId, { system, messages, json = true, validate, maxTokens, cacheTtl = 0 }) {
  const level = models.levels[levelId] || models.levels[models.defaultLevel];
  const chain = [];
  const push = (t, tier) => { if (t && !chain.some(c => c.provider === t.provider && c.model === t.model)) chain.push({ ...t, tier }); };
  push(level?.primary, 'primary');
  (level?.fallback || []).forEach(f => push(f, 'fallback'));
  push(models.reserve, 'reserve');
  // Sem nível configurado: tenta o padrão antes da reserva.
  if (!level?.ok) { const d = models.levels[models.defaultLevel]; push(d?.primary, 'fallback'); (d?.fallback || []).forEach(f => push(f, 'fallback')); }
  const usable = chain.filter(t => getKey(t.provider));
  if (!usable.length) throw new ProviderError('router', -1, 'Nenhum provedor de IA configurado. Salve uma chave do Gemini ou da Anthropic nas integrações.');

  const ck = cacheTtl ? crypto.createHash('sha256').update(JSON.stringify([levelId, system, messages, json])).digest('hex') : null;
  if (ck) { const hit = cacheGet(ck); if (hit) return { ...hit, meta: { ...hit.meta, cached: true } }; }

  let lastErr, skipProvider = new Set(), first = true;
  for (const t of usable) {
    if (skipProvider.has(t.provider)) continue;
    const meta = { provider: t.provider, model: t.model, tier: t.tier, degraded: !first || t.tier !== 'primary' };
    first = false;
    try {
      let text = await withRetry(t, { system, messages, json, maxTokens });
      if (!json) { const out = { data: null, text, meta }; if (ck) cacheSet(ck, out, cacheTtl); return out; }
      try {
        const data = validate ? validate(parseJSONLoose(text)) : parseJSONLoose(text);
        const out = { data, text, meta }; if (ck) cacheSet(ck, out, cacheTtl); return out;
      } catch {
        // JSON inválido: uma nova tentativa pedindo o formato; depois texto simples.
        text = await withRetry(t, { system, json, maxTokens, messages: [...messages, { role: 'assistant', content: text.slice(0, 2000) }, { role: 'user', content: 'Sua resposta anterior não era JSON válido. Responda de novo SOMENTE com o JSON pedido.' }] });
        try { const data = validate ? validate(parseJSONLoose(text)) : parseJSONLoose(text); return { data, text, meta }; }
        catch { return { data: null, text, meta: { ...meta, plain: true } }; }
      }
    } catch (e) {
      lastErr = e;
      log.warn(`[router] ${t.provider}/${t.model} indisponível (${e.status ?? 'erro'}); indo para o próximo.`);
      if (e instanceof ProviderError && [401, 403, -1].includes(e.status)) skipProvider.add(t.provider);
    }
  }
  throw lastErr || new ProviderError('router', 503, 'Todos os provedores falharam.');
}

export function friendlyAIError(e) {
  const s = e?.status;
  if (s === -1) return e.message;
  if (s === 401 || s === 403) return 'A chave do provedor de IA foi recusada. Confira nas integrações.';
  if (s === 429) return 'Cota de uso estourada em todos os provedores. Tente daqui a pouco.';
  if (s === 404) return 'Modelo não encontrado. Confira o models.config.json.';
  if (s === 0) return 'Sem conexão com os provedores de IA.';
  return 'Os provedores de IA falharam agora. Tente de novo em instantes.';
}
