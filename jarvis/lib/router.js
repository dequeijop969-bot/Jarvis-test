// Roteador de provedores: uma camada única para chamar o modelo do nível escolhido.
// 429/5xx: até 3 tentativas com espera exponencial; depois plano B (mesmo provedor) e, por fim, a reserva.
import crypto from 'node:crypto';
import { getKey } from './keys.js';
import { log } from './secrets.js';

export class ProviderError extends Error {
  constructor(provider, status, msg, retryAfter, quota = null) {
    super(msg || `${provider} falhou (${status})`);
    this.provider = provider; this.status = status; this.retryAfter = retryAfter;
    this.quota = quota;   // 429: 'day' (limite diário), 'minute' (por minuto) ou null (não informado)
    this.retryable = status === 429 || status >= 500 || status === 0;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Com plano B (outro modelo ou a outra chave), não vale insistir: 1 nova tentativa e no máximo hasteMs esperando; depois, o próximo.
// hasteMs: prazo com plano B para pedidos curtos (até hasteTokens); código longo usa hasteLongMs.
// busyMs: modelo sobrecarregado (503/504/tempo esgotado) fica de lado nas DUAS chaves por esse tempo.
export const ROUTER = { baseDelay: 600, maxAttempts: 3, cooldownMs: 5 * 60_000, timeoutMs: 60_000, hasteMs: 12_000, hasteLongMs: 45_000, hasteTokens: 1200, hasteAttempts: 2, busyMs: 3 * 60_000, slowMs: 15_000, dayCooldownMs: 60 * 60_000, minCooldownMs: 15_000 }; // ajustável nos testes (slowMs: respondeu, mas demorou demais)

// 429 do Gemini: o corpo diz quanto esperar (RetryInfo.retryDelay, ex. "34s") e qual cota estourou (QuotaFailure.quotaId).
// Cabeçalho retry-after quase nunca vem; sem ler o corpo, não dá para saber se o limite é por minuto ou por dia.
export function parseQuotaError(j, headerRetry = 0) {
  let retryAfter = Number(headerRetry) || 0, quota = null;
  for (const d of Array.isArray(j?.error?.details) ? j.error.details : []) {
    const delay = /^(\d+(?:\.\d+)?)s$/.exec(String(d?.retryDelay || ''));
    if (delay) retryAfter = Math.max(retryAfter, Math.ceil(Number(delay[1])));
    for (const v of Array.isArray(d?.violations) ? d.violations : []) {
      const id = `${v?.quotaId || ''} ${v?.quotaMetric || ''}`;
      if (/PerDay/i.test(id)) quota = 'day';
      else if (/PerMinute/i.test(id) && quota !== 'day') quota = 'minute';
    }
  }
  return { retryAfter, quota };
}

const b64 = d => String(d).replace(/^data:image\/jpeg;base64,/, '');
// Imagens de uma mensagem: a da tela (image) e as que você mandou (images), até 8.
const imagesOf = m => [...(m.image ? [m.image] : []), ...(Array.isArray(m.images) ? m.images : [])].slice(0, 8);
async function callGemini(t, req) {
  const { system, messages, json, maxTokens } = req;
  const key = getKey(t.provider);   // gemini2: a segunda chave, cota própria; geminipago: a chave com faturamento (nível 5.1)
  if (!key) throw new ProviderError(t.provider, -1, 'Sem chave do Gemini.');
  const generationConfig = { maxOutputTokens: maxTokens || 8192 };
  if (t.reasoning) generationConfig.thinkingConfig = { thinkingLevel: t.reasoning };
  if (json) generationConfig.responseMimeType = 'application/json';
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(t.model)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(req.timeout || ROUTER.timeoutMs),
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }, ...imagesOf(m).map(d => ({ inlineData: { mimeType: 'image/jpeg', data: b64(d) } })),
          ...(m.audio ? [{ inlineData: { mimeType: m.audio.mime, data: m.audio.data } }] : []),
          ...(m.pdfs || []).map(p => ({ inlineData: { mimeType: 'application/pdf', data: p.data } }))] })),
        generationConfig
      })
    });
  } catch (e) { throw new ProviderError(t.provider, e?.name === 'TimeoutError' ? 504 : 0, e?.name === 'TimeoutError' ? 'O Gemini demorou demais.' : 'Sem conexão com o Gemini.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const q = r.status === 429 ? parseQuotaError(j, r.headers.get('retry-after')) : { retryAfter: Number(r.headers.get('retry-after')) || 0, quota: null };
    throw new ProviderError('gemini', r.status, null, q.retryAfter, q.quota);
  }
  const parts = j.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!text) throw new ProviderError('gemini', 502, 'Resposta vazia do Gemini.');
  return text;
}

async function callAnthropic(t, req) {
  const { system, messages, maxTokens } = req;
  const key = getKey('anthropic');
  if (!key) throw new ProviderError('anthropic', -1, 'Sem chave da Anthropic.');
  if (messages.some(m => m.audio)) throw new ProviderError('anthropic', 415, 'A Anthropic não recebe áudio por aqui.');   // transcrição: só o Gemini
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(req.timeout || ROUTER.timeoutMs),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: t.model, max_tokens: maxTokens || 4000, system, messages: messages.map(m => m.pdfs?.length || imagesOf(m).length ? { role: m.role, content: [
          ...(m.pdfs || []).map(p => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } })),
          ...imagesOf(m).map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(d) } })),
          { type: 'text', text: m.content }] } : { role: m.role, content: m.content }) })
    });
  } catch { throw new ProviderError('anthropic', 0, 'Sem conexão com a Anthropic.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ProviderError('anthropic', r.status, null, Number(r.headers.get('retry-after')) || 0);
  if (j.stop_reason === 'refusal') throw new ProviderError('anthropic', 422, 'A Anthropic recusou o pedido.');
  const text = (j.content || []).map(c => c.type === 'text' ? c.text : '').join('').trim();
  if (!text) throw new ProviderError('anthropic', 502, 'Resposta vazia da Anthropic.');
  return text;
}
const CALL = { gemini2: callGemini, geminipago: callGemini, gemini: callGemini, anthropic: callAnthropic };

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

// Disjuntor: modelo com cota estourada (429) fica de lado por um tempo e os pedidos vão direto ao próximo,
// sem gastar segundos tentando de novo um modelo que não vai responder.
const cooling = new Map();   // "provedor/modelo" -> até quando pular (cota: vale por chave)
const busy = new Map();      // "modelo" -> até quando pular (sobrecarga do Google: vale para as duas chaves)
export const clearBusy = () => { busy.clear(); cooling.clear(); };
const keyOf = t => `${t.provider}/${t.model}`;
export const clearCooling = () => cooling.clear();

async function withRetry(t, req, retry429 = true) {
  let last;
  // retry429 = false quando há plano B: pressa (menos tentativas e prazo curto), o próximo da lista resolve.
  const tries = retry429 ? ROUTER.maxAttempts : ROUTER.hasteAttempts;
  // Quem pediu mais tempo (documento longo, PDFs e imagens) ganha esse tempo: cortar aos 45 s fazia o modelo bom ser
  // trocado em silêncio pelo plano B no meio de um arquivo grande.
  const haste = (req.maxTokens || 8192) <= ROUTER.hasteTokens ? ROUTER.hasteMs : ROUTER.hasteLongMs;
  const call = retry429 ? req : { ...req, timeout: Math.max(haste, req.timeout || 0) };
  for (let a = 0; a < tries; a++) {
    try { return await CALL[t.provider](t, call); }
    catch (e) {
      last = e;
      if (!(e instanceof ProviderError) || !e.retryable || a === tries - 1) throw e;
      if (e.status === 429 && !retry429) throw e;   // cota estourada e há plano B: não espera, passa para o próximo
      if (e.status === 429 && e.quota === 'day') throw e;   // limite diário: esperar segundos não adianta
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
export async function generate(models, levelId, { system, messages, json = true, validate, maxTokens, cacheTtl = 0, timeout }) {
  const level = models.levels[levelId] || models.levels[models.defaultLevel];
  const chain = [];
  const push = (t, tier) => { if (t && !chain.some(c => c.provider === t.provider && c.model === t.model)) chain.push({ ...t, tier }); };
  push(level?.primary, 'primary');
  (level?.fallback || []).forEach(f => push(f, 'fallback'));
  push(models.reserve, 'reserve');
  // Sem nível configurado: tenta o padrão antes da reserva.
  if (!level?.ok) { const d = models.levels[models.defaultLevel]; push(d?.primary, 'fallback'); (d?.fallback || []).forEach(f => push(f, 'fallback')); }
  const usable = chain.filter(t => getKey(t.provider));
  if (!usable.length) throw new ProviderError('router', -1, 'Nenhum provedor de IA configurado. Salve uma chave do Gemini ou da Anthropic nos ajustes.');

  const ck = cacheTtl ? crypto.createHash('sha256').update(JSON.stringify([levelId, system, messages, json])).digest('hex') : null;
  if (ck) { const hit = cacheGet(ck); if (hit) return { ...hit, meta: { ...hit.meta, cached: true } }; }

  // Modelos em pausa por cota ficam de fora (se todos estiverem, tenta assim mesmo).
  const now = Date.now(), live = usable.filter(t => !(cooling.get(keyOf(t)) > now) && !(busy.get(t.model) > now));
  const order = live.length ? live : usable;
  let lastErr, skipProvider = new Set(), first = true;
  for (const [i, t] of order.entries()) {
    if (skipProvider.has(t.provider) || skipProvider.has(`${t.provider}|${t.model}`)) continue;
    const meta = { provider: t.provider, model: t.model, tier: t.tier, degraded: !first || t.tier !== 'primary' };
    first = false;
    const isLast = order.slice(i + 1).every(n => skipProvider.has(n.provider));
    try {
      const t0 = Date.now();
      let text = await withRetry(t, { system, messages, json, maxTokens, ...(timeout ? { timeout } : {}) }, isLast);
      log.info(`[ia] ${keyOf(t)}: ${Date.now() - t0} ms, ${text.length} caracteres (pedido de ${JSON.stringify(messages).length + String(system).length} caracteres)`);
      cooling.delete(keyOf(t)); busy.delete(t.model);
      // Respondeu, mas lento demais (pedido curto): próximos pedidos usam outro modelo da lista por uns minutos.
      if (Date.now() - t0 > ROUTER.slowMs && (maxTokens || 8192) <= ROUTER.hasteTokens && order.some(n => n.model !== t.model)) {
        busy.set(t.model, Date.now() + ROUTER.busyMs);
        log.warn(`[router] ${t.model} lento (${Math.round((Date.now() - t0) / 1000)} s): usando outro modelo por ${Math.round(ROUTER.busyMs / 60_000)} min.`);
      }
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
      // Sobrecarregado (não é cota): pula esse modelo nas duas chaves por uns minutos, se houver outro modelo na lista.
      if (e instanceof ProviderError && [503, 504, 0].includes(e.status) && order.some(n => n.model !== t.model)) {
        busy.set(t.model, Date.now() + ROUTER.busyMs);
        log.warn(`[router] ${t.model} sobrecarregado: usando outro modelo por ${Math.round(ROUTER.busyMs / 60_000)} min.`);
        for (const n of order) if (n.model === t.model) skipProvider.add(`${n.provider}|${n.model}`);
      }
      if (e instanceof ProviderError && e.status === 429) {
        // Limite diário: o modelo só volta no reset, então fica de fora por mais tempo (re-testa de hora em hora).
        // Limite por minuto: volta quando o Google disse (retryDelay), com um piso curto, para não perder o modelo por 5 min à toa.
        const ms = e.quota === 'day' ? ROUTER.dayCooldownMs
          : e.quota === 'minute' || e.retryAfter ? Math.min(5 * 60_000, Math.max(ROUTER.minCooldownMs, (e.retryAfter || 0) * 1000 + 2000))
          : Math.min(15 * 60_000, Math.max(60_000, ROUTER.cooldownMs));
        cooling.set(keyOf(t), Date.now() + ms);
        log.warn(`[router] ${keyOf(t)} sem cota (${e.quota === 'day' ? 'limite diário' : e.quota === 'minute' ? 'limite por minuto' : 'tipo não informado'}): pulando por ${ms >= 60_000 ? Math.round(ms / 60_000) + ' min' : Math.round(ms / 1000) + ' s'}.`);
      }
    }
  }
  throw lastErr || new ProviderError('router', 503, 'Todos os provedores falharam.');
}

export function friendlyAIError(e) {
  const s = e?.status;
  if (s === -1) return e.message;
  if (s === 401 || s === 403) return 'A chave do provedor de IA foi recusada. Confira nos ajustes.';
  if (s === 429) return 'Cota de uso estourada em todos os provedores. Tente daqui a pouco.';
  if (s === 404) return 'Modelo não encontrado. Confira o models.config.json.';
  if (s === 0) return 'Sem conexão com os provedores de IA.';
  return 'Os provedores de IA falharam agora. Tente de novo em instantes.';
}
