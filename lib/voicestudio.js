// Voz do JARVIS pelo VoiceStudio (https://github.com/debpalash/VoiceStudio), rodando NESTE computador.
// O Jarvis só conversa com ele por HTTP (a API compatível com a OpenAI, /v1/audio/speech); nenhum código do
// VoiceStudio (AGPL) entra no Jarvis. Liga com VOICESTUDIO_VOICE no .env (o id ou o nome do perfil de voz).
// Se o VoiceStudio estiver fechado ou lento, a frase sai na voz da Microsoft (Rémy) e ele fica de lado por um tempo.

import { spawn } from 'node:child_process';

export const VS = {
  url: () => (process.env.VOICESTUDIO_URL || 'http://127.0.0.1:3900').replace(/\/+$/, ''),
  voice: () => (process.env.VOICESTUDIO_VOICE || '').trim(),
  // Tempo máximo por frase: cresce com o tamanho (neste PC a voz sai mais devagar que a fala). Com um limite fixo, as
  // frases longas estouravam e saíam na voz reserva no meio da resposta ("tons diferentes").
  timeout: 20_000, downMs: 2 * 60_000, slowMs: 15_000, downUntil: 0,
  // O VoiceStudio desliga o motor do PocketTTS quando fica parado (medido: frio de novo em menos de 4 min, ~15 s para
  // voltar): aquece a cada 2 min. Também aquece na hora em que alguém chama "Jarvis".
  warmEveryMs: 2 * 60_000, warmTimeout: 180_000, warming: null,
  ffmpeg: () => process.env.FFMPEG || 'ffmpeg',
  seed: () => Number(process.env.VOICESTUDIO_SEED || 42)
};

// Abaixa o tom com o ffmpeg (rubberband, alta qualidade, ~0,3 s por frase). Peito: muda também os formantes
// (timbre de homem "maior"). Sem ffmpeg ou se algo falhar, devolve o áudio como veio.
export function lowerTone(wav, semis, chest = false) {
  if (!(semis < 0) || semis < -6) return Promise.resolve(wav);
  const ratio = (2 ** (semis / 12)).toFixed(4);
  return new Promise(res => {
    let p; try {
      p = spawn(VS.ffmpeg(), ['-v', 'error', '-f', 'wav', '-i', 'pipe:0', '-af', `rubberband=pitch=${ratio}:formant=${chest ? 'shifted' : 'preserved'}:pitchq=quality:transients=smooth`, '-f', 'wav', 'pipe:1'], { windowsHide: true });
    } catch { return res(wav); }
    const out = [], kill = setTimeout(() => p.kill(), 5000);
    p.stdout.on('data', d => out.push(d));
    p.on('error', () => { clearTimeout(kill); res(wav); });
    p.on('close', code => { clearTimeout(kill); const b = Buffer.concat(out); res(code === 0 && b.length > 200 ? b : wav); });
    p.stdin.on('error', () => {}); p.stdin.end(wav);
  });
}
export const vsReady = () => !!VS.voice() && VS.downUntil <= Date.now();

// Fila: o VoiceStudio gera UMA frase por vez no processador e recusa (429) o que chega enquanto outra está na fila.
// Antes, pedir as frases em paralelo fazia algumas saírem na voz da Microsoft (a voz "mudava" no meio da resposta).
// Agora elas esperam a vez aqui, na ordem em que foram pedidas.
let tail = Promise.resolve(), queued = 0;
export const vsBusy = () => queued > 0;
export function vsTTS(text, opts = {}) {
  if (!VS.voice()) return Promise.reject(new Error('VoiceStudio sem voz configurada (VOICESTUDIO_VOICE).'));
  if (VS.downUntil > Date.now()) return Promise.reject(new Error('VoiceStudio fora do ar há pouco.'));
  queued++;
  const job = tail.then(() => synth(text, opts)).finally(() => { queued--; });
  tail = job.catch(() => {});
  return job;
}

async function synth(text, { lang = 'pt-BR' } = {}) {
  if (VS.downUntil > Date.now()) throw new Error('VoiceStudio fora do ar há pouco.');
  // Aquecimento em andamento (o motor carregando): espera ele, em vez de levar "ocupado" e cair na voz da Microsoft.
  if (VS.warming) await VS.warming;
  const t0 = Date.now();
  try {
    let r;
    for (let tries = 0; ; tries++) {
      r = await fetch(`${VS.url()}/v1/audio/speech`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(Math.max(VS.timeout, 15_000 + String(text).length * 350)),
        // WAV (PCM): dá para medir onde há fala e onde há pausa, e assim cronometrar a legenda.
        // seed fixo: cada frase é gerada à parte, e sem ele o PocketTTS sorteia timbre e entonação um pouco diferentes a cada uma
        // (a voz parecia "alternar" no meio da resposta). Com o mesmo seed, todas saem do mesmo jeito.
        body: JSON.stringify({ model: 'tts-1', voice: VS.voice(), input: text, response_format: 'wav', language: lang.slice(0, 2), seed: VS.seed() })
      });
      // Ocupado com outra coisa (o aquecimento, o próprio app do VoiceStudio): espera um pouco e tenta de novo.
      if (r.status !== 429 || tries >= 20) break;
      await r.arrayBuffer().catch(() => {}); await new Promise(z => setTimeout(z, 300));
    }
    if (!r.ok) {
      let msg = ''; try { const j = await r.json(); msg = j?.error?.message || j?.detail || ''; } catch { /* corpo não é JSON */ }
      throw Object.assign(new Error(`VoiceStudio recusou (${r.status})${msg ? `: ${String(msg).slice(0, 140)}` : ''}.`), { busy: r.status === 429 });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 200) throw new Error('VoiceStudio devolveu um áudio vazio.');
    // O VoiceStudio não manda tempo por palavra: calculamos pelo próprio áudio (silêncio no início e pausas entre frases).
    let words = null, out = buf;
    try {
      // O PocketTTS deixa pausas de 1–2 s entre frases: encurta para no máximo 0,35 s (fala mais fluida).
      // E ganha corpo: graves reforçados e agudos um pouco mais macios (VOICESTUDIO_CORPO, em dB; 0 desliga).
      // Às vezes o PocketTTS "não acha o fim" e continua balbuciando depois da frase: corta o que passar muito do esperado.
      const pcm = addBody(trimRunaway(tightenPauses(readWav(buf)), text), Number(process.env.VOICESTUDIO_CORPO ?? 4));
      // Tom mais grave no áudio final (VOICESTUDIO_TOM, em semitons; ex.: -1). Mudar o tom só muda a altura, não a
      // duração, então a legenda continua valendo. Na referência isso deixava a voz rouca; aqui, não.
      out = await lowerTone(writeWav(pcm), Number(process.env.VOICESTUDIO_TOM || 0), process.env.VOICESTUDIO_PEITO === '1');
      words = wordTimes(text, speechSegments(pcm));
    } catch { /* WAV inesperado: vai como veio e a página estima a legenda pela duração */ }
    return { audio: out.toString('base64'), mime: 'audio/wav', words, provider: 'voicestudio', voice: VS.voice(), ms: Date.now() - t0 };
  } catch (e) {
    // Demorou (motor recarregando): tenta de novo logo e aquece em segundo plano. Ocupado (429): não é falha, nem
    // tira o VoiceStudio da vez. Fechado/erro: fica de lado 2 min.
    const slow = e.name === 'TimeoutError';
    if (e.busy) throw e;
    VS.downUntil = Date.now() + (slow ? VS.slowMs : VS.downMs);
    if (slow) warmVoiceStudio(1);
    throw slow ? new Error('VoiceStudio demorou demais.') : e;
  }
}

// Mantém o motor carregado: o VoiceStudio descarrega depois de 15 min parado, e a primeira frase depois disso
// levava ~20–70 s (o Jarvis desistia e falava com a Microsoft). Uma frase curtinha a cada 8 min evita isso.
export function warmVoiceStudio(self = 0) {   // self: quantos pedidos da fila são de quem chamou (não contam)
  if (!VS.voice() || VS.warming) return VS.warming;
  if (queued - self > 0) return Promise.resolve(true);   // já está falando: o motor está quente e o aquecimento só atrapalharia a fila
  VS.warming = fetch(`${VS.url()}/v1/audio/speech`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(VS.warmTimeout),
    body: JSON.stringify({ model: 'tts-1', voice: VS.voice(), input: 'Pronto.', response_format: 'wav', language: 'pt' })
  }).then(async r => { await r.arrayBuffer(); if (r.ok) VS.downUntil = 0; return r.ok; })
    .catch(() => false).finally(() => { VS.warming = null; });
  return VS.warming;
}
export function startVoiceStudioWarmup() {
  if (!VS.voice()) return null;
  warmVoiceStudio();
  const t = setInterval(() => warmVoiceStudio(), VS.warmEveryMs); t.unref?.();
  // Fora do ar (fechado, caiu, ainda subindo): confere a cada 15 s e volta para a voz do VoiceStudio assim que ele
  // responder, em vez de ficar até 2 min na voz reserva.
  const p = setInterval(() => { if (VS.downUntil > Date.now()) warmVoiceStudio(); }, 15_000); p.unref?.();
  return t;
}

// WAV PCM (16 bits ou float 32) → amostras mono em [-1, 1] + taxa.
export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Não é WAV.');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4); let size = buf.readUInt32LE(off + 4);
    if (id === 'data' && (size === 0 || size === 0xFFFFFFFF || off + 8 + size > buf.length)) size = buf.length - off - 8;   // tamanho desconhecido (streaming)
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(off + 8), ch: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') { data = buf.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV sem fmt/data.');
  const step = (fmt.bits / 8) * fmt.ch, n = Math.floor(data.length / step), s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = fmt.bits === 16 ? data.readInt16LE(i * step) / 32768 : fmt.bits === 32 && fmt.tag === 3 ? data.readFloatLE(i * step) : 0;
  return { samples: s, rate: fmt.rate };
}

// Trechos com fala (em segundos): energia em janelas de 10 ms, juntando pausas curtas (< 140 ms).
export function speechSegments({ samples, rate }) {
  const win = Math.max(1, Math.round(rate / 100)), rms = [];
  for (let i = 0; i < samples.length; i += win) {
    let e = 0; const end = Math.min(samples.length, i + win);
    for (let k = i; k < end; k++) e += samples[k] * samples[k];
    rms.push(Math.sqrt(e / (end - i)));
  }
  const peak = Math.max(...rms, 1e-6), thr = Math.max(peak * 0.06, 0.004), segs = [];
  let start = -1;
  rms.forEach((v, i) => { if (v >= thr && start < 0) start = i; if (v < thr && start >= 0) { segs.push([start, i]); start = -1; } });
  if (start >= 0) segs.push([start, rms.length]);
  const merged = [];
  for (const sg of segs) { const last = merged.at(-1); if (last && sg[0] - last[1] < 14) last[1] = sg[1]; else merged.push([...sg]); }
  return merged.filter(([a, b]) => b - a >= 4).map(([a, b]) => [a / 100, b / 100]);
}

// Silêncios longos viram no máximo `maxGap` segundos; o silêncio do início fica em 50 ms.
export function tightenPauses({ samples, rate }, maxGap = 0.35) {
  const segs = speechSegments({ samples, rate });
  if (!segs.length) return { samples, rate };
  const keep = [], half = Math.round(maxGap * rate / 2), lead = Math.round(0.05 * rate);
  let prevEnd = Math.max(0, Math.round(segs[0][0] * rate) - lead);
  segs.forEach(([s, e], k) => {
    const a = Math.round(s * rate), b = Math.min(samples.length, Math.round(e * rate));
    if (k > 0 && a - prevEnd > 2 * half) { keep.push([prevEnd, prevEnd + half]); keep.push([a - half, b]); }
    else keep.push([prevEnd, b]);
    prevEnd = b;
  });
  keep.push([prevEnd, Math.min(samples.length, prevEnd + Math.round(0.12 * rate))]);   // um respiro no fim
  const out = new Float32Array(keep.reduce((n, [a, b]) => n + Math.max(0, b - a), 0));
  let o = 0; for (const [a, b] of keep) { out.set(samples.subarray(a, b), o); o += Math.max(0, b - a); }
  return { samples: out, rate };
}

// Duração esperada da fala (~0,13 s por sílaba + respiro nas pontuações); trechos que COMEÇAM depois de 1,35× isso
// são o motor falando sozinho e saem (com 120 ms de cauda para não cortar seco).
export function expectedSeconds(text) {
  const s = String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const syl = (s.match(/[aeiouy]+/g) || []).length, digits = (s.match(/\d/g) || []).length, punct = (s.match(/[.,;:!?…]/g) || []).length;
  return 0.3 + syl * 0.13 + digits * 0.3 + punct * 0.15;
}
export function trimRunaway({ samples, rate }, text) {
  const limit = Math.max(1.5, expectedSeconds(text) * 1.35), segs = speechSegments({ samples, rate });
  const bad = segs.find(([s]) => s > limit);
  if (!bad) return { samples, rate };
  const prev = segs[segs.indexOf(bad) - 1], end = Math.min(samples.length, Math.round(((prev ? prev[1] : limit) + 0.12) * rate));
  return { samples: samples.slice(0, end), rate };
}

// Filtros biquad (receitas de Robert Bristow-Johnson): prateleira de graves e de agudos.
function shelf(samples, rate, type, f0, gainDb, S = 0.8) {
  const A = 10 ** (gainDb / 40), w = 2 * Math.PI * f0 / rate, cs = Math.cos(w), sn = Math.sin(w);
  const al = sn / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2), r = 2 * Math.sqrt(A) * al, sg = type === 'low' ? 1 : -1;
  const b0 = A * ((A + 1) - sg * (A - 1) * cs + r), b1 = sg * 2 * A * ((A - 1) - sg * (A + 1) * cs), b2 = A * ((A + 1) - sg * (A - 1) * cs - r);
  const a0 = (A + 1) + sg * (A - 1) * cs + r, a1 = -sg * 2 * ((A - 1) + sg * (A + 1) * cs), a2 = (A + 1) + sg * (A - 1) * cs - r;
  const out = new Float32Array(samples.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}
// Voz mais encorpada sem ficar rouca: só equalização (nada de compressão ou saturação, que dão o "chiado de fumante").
export function addBody({ samples, rate }, db = 4) {
  if (!(db > 0)) return { samples, rate };
  let s = shelf(samples, rate, 'low', 160, Math.min(db, 9));
  s = shelf(s, rate, 'high', 5000, -Math.min(db, 9) / 2);
  let peak = 0; for (const v of s) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.97) for (let i = 0; i < s.length; i++) s[i] *= 0.97 / peak;   // ganho nos graves não pode estourar
  return { samples: s, rate };
}

export function writeWav({ samples, rate }) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}

// Tempo de cada palavra. Cada trecho de fala (entre pausas) recebe um grupo contíguo de palavras: programação
// dinâmica em que a fatia de peso (~ sílabas) do grupo bate com a fatia de duração do trecho, com leve preferência
// por cortar em pontuação (a voz também pausa onde não há vírgula). Dentro do trecho, divide pelo peso.
export function wordTimes(text, segs) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length || !segs.length) return null;
  const punct = w => /[.,;:!?…]$/.test(w);
  const wts = words.map(w => Math.max(1, (w.normalize('NFD').match(/[aeiouy]/gi) || []).length) + (punct(w) ? 0.6 : 0));
  const W = words.length, S = segs.length, dur = segs.map(([s, e]) => e - s);
  const totW = wts.reduce((a, b) => a + b, 0), totD = dur.reduce((a, b) => a + b, 0), pre = [0];
  wts.forEach(x => pre.push(pre.at(-1) + x));
  let groups = null;
  if (W >= S) {
    const cost = Array.from({ length: S + 1 }, () => new Array(W + 1).fill(Infinity)), from = cost.map(r => r.map(() => 0));
    cost[0][0] = 0;
    for (let j = 1; j <= S; j++) for (let i = j; i <= W - (S - j); i++) for (let k = j - 1; k < i; k++) {
      if (cost[j - 1][k] === Infinity) continue;
      const cut = j < S && !punct(words[i - 1]) ? 0.04 : 0;
      const c = cost[j - 1][k] + Math.abs((pre[i] - pre[k]) / totW - dur[j - 1] / totD) + cut;
      if (c < cost[j][i]) { cost[j][i] = c; from[j][i] = k; }
    }
    groups = []; let i = W;
    for (let j = S; j > 0; j--) { const k = from[j][i]; groups.unshift([k, i]); i = k; }
  }
  if (!groups) groups = [[0, words.length]];   // mais pausas que pontuação: espalha tudo pelo tempo de fala total
  const spans = groups.length === S ? segs.map(s => [s]) : [segs];
  const out = [];
  groups.forEach(([a, b], g) => {
    const sg = spans[g], speech = sg.reduce((x, [s, e]) => x + (e - s), 0), tot = wts.slice(a, b).reduce((x, y) => x + y, 0);
    const at = x => { for (const [s, e] of sg) { if (x <= e - s) return s + x; x -= e - s; } return sg.at(-1)[1]; };
    let acc = 0;
    for (let i = a; i < b; i++) {
      const s = acc / tot * speech; acc += wts[i];
      out.push({ w: words[i], s: +at(s).toFixed(3), e: +at(acc / tot * speech - 1e-6).toFixed(3) });
    }
  });
  return out;
}
