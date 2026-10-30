// Voz neural gratuita da Microsoft (a mesma da "Leitura em voz alta" do Edge). Sem chave, sem cota.
// Devolve MP3 + tempo de cada palavra (WordBoundary), então as legendas continuam sincronizadas como na ElevenLabs.
// É um serviço não oficial: se a Microsoft mudar o protocolo, o JARVIS cai para a voz do navegador.
import { randomUUID, randomBytes } from 'node:crypto';
import https from 'node:https';
import { secGecV2 } from './edgedrm.js';

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
// Versão do Edge que o serviço aceita junto com o token v2 (a mesma do projeto edge-tts). Mudou? Troque aqui.
const CHROMIUM = '143.0.3650.75';
const BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
export const EDGE = { connect: null, timeout: 25_000, downMs: 30 * 60_000, downUntil: 0 }; // connect trocável nos testes

/* WebSocket mínimo (o WebSocket nativo do Node não completa o handshake com esse servidor).
   Só o necessário: handshake, enviar texto (com máscara), receber texto/binário (com fragmentos), fechar. */
function connect(url, headers) {
  const u = new URL(url), key = randomBytes(16).toString('base64');
  const api = { onopen: null, onmessage: null, onerror: null, onclose: null, binaryType: 'arraybuffer', send: () => {}, close: () => {} };
  const req = https.request({ host: u.host, path: u.pathname + u.search, headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key } });
  let closed = false;
  const fin = () => { if (closed) return; closed = true; api.onclose?.({}); };
  req.on('response', r => { EDGE.lastStatus = r.statusCode; EDGE.serverDate = r.headers.date; r.resume(); api.onerror?.({}); fin(); });
  req.on('error', () => { api.onerror?.({}); fin(); });
  req.on('upgrade', (res, sock) => {
    let buf = Buffer.alloc(0), frag = [], fragOp = 0;
    api.send = data => {
      const payload = Buffer.from(data, 'utf8'), mask = randomBytes(4), n = payload.length;
      const head = n < 126 ? Buffer.from([0x81, 0x80 | n]) : n < 65536 ? Buffer.from([0x81, 0xfe, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 0xff]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
      for (let i = 0; i < n; i++) payload[i] ^= mask[i & 3];
      sock.write(Buffer.concat([head, mask, payload]));
    };
    api.close = () => { try { sock.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0])); } catch { /* já fechado */ } sock.destroy(); fin(); };
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15, last = !!(buf[0] & 128); let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const data = buf.subarray(off, off + len); buf = buf.subarray(off + len);
        if (op === 8) { api.close(); return; }
        if (op === 9) { sock.write(Buffer.from([0x8a, 0x80, 0, 0, 0, 0])); continue; }
        if (op === 1 || op === 2) { fragOp = op; frag = [data]; } else if (op === 0) frag.push(data); else continue;
        if (last) { const all = Buffer.concat(frag); api.onmessage?.({ data: fragOp === 1 ? all.toString('utf8') : all }); frag = []; }
      }
    });
    sock.on('close', fin); sock.on('error', () => { api.onerror?.({}); fin(); });
    api.onopen?.();
  });
  req.end();
  return api;
}

// Vozes escolhidas para o estilo mordomo: masculinas, graves e calmas.
export const VOICES = {
  // As "Multilingual" são de geração mais nova (mais humanas) e falam português detectando o idioma pelo texto.
  'pt-BR': [{ id: 'pt-BR-AntonioNeural', label: 'Antonio · brasileiro, grave' }, { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew · multilíngue, caloroso e confiante' },
    { id: 'en-US-BrianMultilingualNeural', label: 'Brian · multilíngue, natural e casual' }, { id: 'de-DE-FlorianMultilingualNeural', label: 'Florian · multilíngue, grave' },
    { id: 'it-IT-GiuseppeMultilingualNeural', label: 'Giuseppe · multilíngue' }, { id: 'en-AU-WilliamMultilingualNeural', label: 'William · multilíngue' },
    { id: 'fr-FR-RemyMultilingualNeural', label: 'Rémy · multilíngue' }, { id: 'pt-BR-ThalitaMultilingualNeural', label: 'Thalita · feminina, multilíngue' }, { id: 'pt-BR-FranciscaNeural', label: 'Francisca · feminina' }],
  'en-US': [{ id: 'en-GB-RyanNeural', label: 'Ryan (inglês britânico)' }, { id: 'en-US-AndrewNeural', label: 'Andrew (en-US)' }],
  'es-ES': [{ id: 'es-ES-AlvaroNeural', label: 'Álvaro (es-ES)' }]
};
// Voz de reserva (a principal é a do VoiceStudio): o Antonio, brasileiro nativo e grave. Antes era o Rémy, francês
// "multilíngue", que adivinha o idioma pelo texto e às vezes lia o português com pronúncia francesa.
export const JARVIS_VOICE = 'pt-BR-AntonioNeural';
export const defaultVoice = () => JARVIS_VOICE;

// Token v2 (lib/edgedrm.js): checksum + SHA-256, a partir da hora (com o ajuste de relógio) e do token público.
const secGec = () => secGecV2(Date.now() + (EDGE.skew || 0), TOKEN);
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const stamp = () => new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');

export async function edgeTTS(text, opts = {}) {
  // Disjuntor: a Microsoft recusou (403) há pouco? Nem tenta: cai na hora para a voz do navegador (antes, cada frase perdia ~1 s).
  if (EDGE.downUntil > Date.now()) throw new Error('Voz da Microsoft recusando conexões agora.');
  EDGE.lastStatus = 0;
  try { return await edgeOnce(text, opts); }
  catch (e) {
    // 403 costuma ser relógio do PC fora de hora: ajusta pela hora do servidor da Microsoft e tenta uma vez.
    const d = Date.parse(EDGE.serverDate || '');
    if (EDGE.lastStatus !== 403 || !Number.isFinite(d)) throw e;
    EDGE.skew = d - Date.now();
    try { return await edgeOnce(text, opts); }
    catch (e2) { if (EDGE.lastStatus === 403) EDGE.downUntil = Date.now() + EDGE.downMs; throw e2; }
  }
}

async function edgeOnce(text, { voice = JARVIS_VOICE, rate = '-6%', pitch = '-8Hz', lang = 'pt-BR' } = {}) {
  if (!/^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(voice)) throw new Error('Voz inválida.');
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(lang)) lang = 'pt-BR';
  if (!/^[+-]\d{1,2}%$/.test(rate) || !/^[+-]\d{1,2}Hz$/.test(pitch)) throw new Error('Velocidade ou tom inválidos.');
  const id = randomUUID().replace(/-/g, '');
  const url = `${BASE}?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${secGec()}&Sec-MS-GEC-Version=2-${CHROMIUM}&ConnectionId=${id}`;
  const ws = (EDGE.connect || connect)(url, {
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', Pragma: 'no-cache', 'Cache-Control': 'no-cache',
    'Accept-Encoding': 'gzip, deflate, br, zstd', 'Accept-Language': 'en-US,en;q=0.9',
    Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,   // identificador aleatório por conexão, como o Edge manda
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM.split('.')[0]}.0.0.0`
  });
  const chunks = [], words = [];
  return await new Promise((resolve, reject) => {
    const done = (err, val) => { clearTimeout(timer); try { ws.close(); } catch { /* já fechado */ } err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => done(new Error('A voz da Microsoft não respondeu a tempo.')), EDGE.timeout);
    ws.onerror = () => done(new Error('Sem conexão com a voz da Microsoft.'));
    ws.onclose = () => { if (!chunks.length) done(new Error('A voz da Microsoft fechou a conexão sem áudio.')); };
    ws.onopen = () => {
      ws.send(`X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
      // O Rémy é francês "multilíngue": sem dizer o idioma do texto, ele às vezes lia o português como francês ou
      // espanhol. O <lang> fixa o idioma de leitura (pt-BR), mantendo a voz dele.
      const body = xml(text);
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${body}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    };
    ws.onmessage = ev => {
      if (typeof ev.data === 'string') {
        const [head, body = ''] = ev.data.split('\r\n\r\n');
        if (head.includes('Path:audio.metadata')) {
          try {
            for (const m of JSON.parse(body).Metadata || []) if (m.Type === 'WordBoundary') {
              const s = m.Data.Offset / 1e7, w = m.Data.text?.Text || '';
              if (w) words.push({ w, s: +s.toFixed(3), e: +(s + m.Data.Duration / 1e7).toFixed(3) });
            }
          } catch { /* metadado ilegível: segue sem ele */ }
        } else if (head.includes('Path:turn.end')) {
          if (!chunks.length) return done(new Error('A voz da Microsoft não devolveu áudio.'));
          done(null, { audio: Buffer.concat(chunks).toString('base64'), mime: 'audio/mpeg', words: alignWords(text, words), provider: 'edge', voice });
        }
        return;
      }
      const buf = Buffer.from(ev.data), hl = buf.readUInt16BE(0), head = buf.subarray(2, 2 + hl).toString();
      if (head.includes('Path:audio') && buf.length > 2 + hl) chunks.push(buf.subarray(2 + hl));
    };
  });
}

// A Microsoft devolve palavras sem pontuação; a legenda fica mais bonita com o texto original ("senhor," em vez de "senhor").
export function alignWords(text, words) {
  if (!words.length) return null;
  const orig = String(text).split(/\s+/).filter(Boolean), norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let j = 0;
  return words.map(x => {
    const n = norm(x.w);
    for (let k = j; k < Math.min(orig.length, j + 4); k++) if (norm(orig[k]).startsWith(n) || (n && norm(orig[k]).includes(n))) { j = k + 1; return { ...x, w: orig[k] }; }
    return x;
  });
}
