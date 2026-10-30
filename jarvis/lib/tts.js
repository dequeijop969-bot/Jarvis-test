// Voz: ElevenLabs (quando há chave e créditos) e a voz neural gratuita da Microsoft (sem cota) como padrão ou plano B.
// ElevenLabs: caminho principal /with-timestamps (alinhamento por caractere); plano B: áudio simples.
import { getElevenSlots } from './keys.js';
import { edgeTTS, defaultVoice } from './edgetts.js';
import { log } from './secrets.js';
import { vsReady, vsTTS } from './voicestudio.js';

export class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const MSG = {
  401: 'Chave da ElevenLabs inválida. Confira nos ajustes.', 402: 'A ElevenLabs recusou (402): créditos esgotados ou voz da biblioteca que exige plano pago.',
  403: 'A ElevenLabs recusou o acesso.', 404: 'Voz não encontrada. Confira o ID da voz.', 429: 'Limite de uso da ElevenLabs atingido.'
};
const friendly = s => MSG[s] || `A ElevenLabs falhou (erro ${s}).`;

// Converte o alinhamento por caractere da ElevenLabs em tempos por palavra.
export function wordsFromAlignment(al) {
  const ch = al?.characters, s = al?.character_start_times_seconds, e = al?.character_end_times_seconds;
  if (!Array.isArray(ch) || !ch.length || ch.length !== s?.length || ch.length !== e?.length) return null;
  const words = []; let cur = null;
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) { if (cur) { words.push(cur); cur = null; } continue; }
    if (!cur) cur = { w: '', s: s[i], e: e[i] };
    cur.w += ch[i]; cur.e = e[i];
  }
  if (cur) words.push(cur);
  return words.length ? words.map(w => ({ w: w.w, s: +w.s.toFixed(3), e: +w.e.toFixed(3) })) : null;
}

// Uma tentativa com uma chave específica. Lança HttpError com .status (código da ElevenLabs) quando falha.
async function ttsWith({ key, voice }, text) {
  const base = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`;
  const headers = { 'xi-api-key': key, 'content-type': 'application/json' };
  // Estabilidade um pouco mais baixa e algum estilo: entonação menos monótona (menos "robótica").
  const body = JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2', voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } });
  let status = 0, detail = '';
  const readDetail = async r => { try { const j = await r.clone().json(); const d = j?.detail; return String(d?.status || d?.message || (typeof d === 'string' ? d : '') || '').slice(0, 120); } catch { return ''; } };
  try {
    const r = await fetch(`${base}/with-timestamps?output_format=mp3_44100_128`, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
    status = r.status;
    if (!r.ok) detail = await readDetail(r);
    if (r.ok) {
      const j = await r.json();
      if (j.audio_base64) return { audio: j.audio_base64, mime: 'audio/mpeg', words: wordsFromAlignment(j.alignment) || wordsFromAlignment(j.normalized_alignment) };
    }
  } catch { /* cai no plano B */ }
  if ([401, 402, 404].includes(status)) throw Object.assign(new HttpError(502, friendly(status)), { status, detail });
  const r = await fetch(`${base}?output_format=mp3_44100_128`, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!r) throw Object.assign(new HttpError(502, 'Sem conexão com a ElevenLabs.'), { status: 0 });
  if (!r.ok) throw Object.assign(new HttpError(502, friendly(r.status)), { status: r.status, detail: await readDetail(r) });
  return { audio: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: r.headers.get('content-type') || 'audio/mpeg', words: null };
}

// Erros em que vale tentar a próxima conta (chave/créditos/limite/voz da conta/instabilidade).
const TRY_NEXT = s => s === 0 || [401, 402, 403, 404, 429].includes(s) || s >= 500;

// Conta sem créditos/chave recusada: fica de lado por 30 min (antes, cada frase tentava as 4 contas, duas vezes cada).
const deadSlot = new Map();   // n -> até quando pular
const liveSlots = () => getElevenSlots().filter(x => x.voice && !(deadSlot.get(x.n) > Date.now()));
export const elevenReady = () => liveSlots().length > 0;

// Escolhe o provedor conforme a preferência do perfil:
//  auto       → ElevenLabs se configurada; se falhar (créditos, limite, rede), Microsoft. Sem ElevenLabs, Microsoft direto.
//  edge       → Microsoft; se falhar, ElevenLabs (se houver).
//  elevenlabs → só ElevenLabs, com a Microsoft como último recurso.
//  browser    → o servidor não sintetiza; o navegador fala com a voz do sistema.
export async function tts(raw, prefs = {}) {
  const text = String(raw || '').slice(0, 1500).trim();
  if (!text) throw new HttpError(400, 'Texto vazio.');
  // A voz é fixa (reserva: o Antonio, brasileiro): não há mais escolha de voz nem de provedor nos ajustes.
  const provider = prefs.provider === 'elevenlabs' ? 'elevenlabs' : 'edge', lang = prefs.lang || 'pt-BR';
  // Ritmo normal de conversa (antes -6%: ficava arrastado). "ms" deixa a página medir a velocidade e juntar as frases.
  const edge = () => { const t0 = Date.now(); return edgeTTS(text, { voice: defaultVoice(lang), rate: '+4%', pitch: '-6Hz', lang }).then(r => ({ ...r, ms: Date.now() - t0 }))
    .catch(e => { throw Object.assign(new HttpError(502, `Voz da Microsoft indisponível: ${e.message}`), { browser: true }); }); };
  // Voz própria do JARVIS no VoiceStudio (local), quando configurada; a Microsoft fica de reserva.
  if (vsReady()) {
    try { return await vsTTS(text, { lang }); }
    catch (e) { log.warn(`VoiceStudio indisponível, usando a voz da Microsoft: ${e.message}`); return { ...(await edge()), fallback: true }; }
  }
  if (provider === 'edge' || !elevenReady()) {
    try { return await edge(); } catch (e) { if (!elevenReady()) throw e; return { ...(await elevenTTS(text)), provider: 'elevenlabs' }; }
  }
  try { return { ...(await elevenTTS(text)), provider: 'elevenlabs' }; }
  catch (e) { log.warn(`ElevenLabs indisponível, usando a voz da Microsoft: ${e.message}`); return { ...(await edge()), fallback: true }; }
}

export async function elevenTTS(text) {
  const slots = liveSlots();
  if (!slots.length) throw new HttpError(503, 'Voz indisponível: configure a ElevenLabs (chave e ID da voz) nos ajustes.');
  if (!text) throw new HttpError(400, 'Texto vazio.');
  const falhas = [];
  const PASSAGEIRO = s => s === 0 || s === 429 || s >= 500;   // vale insistir na mesma conta
  for (const slot of slots) {
    try {
      try { return await ttsWith(slot, text); }
      catch (e) {
        if (!PASSAGEIRO(e.status ?? 0)) throw e;
        await new Promise(r => setTimeout(r, 800));            // 1 nova tentativa na mesma conta
        return await ttsWith(slot, text);
      }
    } catch (e) {
      if (!TRY_NEXT(e.status ?? 0)) throw e;
      const motivo = `conta ${slot.n}: erro ${e.status || 'rede'}${e.detail ? ` (${e.detail})` : ''} - ${e.message}`;
      falhas.push(motivo); log.warn(`ElevenLabs: ${motivo}`);
      if ([401, 402, 403].includes(e.status)) deadSlot.set(slot.n, Date.now() + 30 * 60_000);
    }
  }
  throw new HttpError(502, `Todas as contas da ElevenLabs falharam. ${falhas.join(' | ')}`);
}
