// Reconhecimento de voz mais preciso. O Chrome transcreve, mas erra nomes próprios ("estime" por Steam,
// "jarbas" por Jarvis, "vê esse code" por VS Code) e às vezes fica em dúvida. Aqui:
//   1. fixSpeech: corrige os erros mais comuns em pt-BR (só em pedidos falados, nunca no que foi digitado);
//   2. pickBest: entre os palpites do Chrome, escolhe o que faz mais sentido (confiança + palavras conhecidas:
//      apps instalados, sites, comandos do Jarvis);
//   3. transcribe: quando o Chrome está inseguro, a IA ouve o áudio de novo, já sabendo os nomes que você costuma falar.
import { ASSISTANT_NAME } from './config.js';

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// [padrão (sem acento, minúsculas, entre limites de palavra), troca]
const FIXES = [
  [/\b(jarbas|jarvas|jarves|jarviz|jervis|jarvi|jarvys|garvis|jabes|ja vis|ja viz|jarvis)\b/g, 'Jarvis'],
  [/\b(estime|esteem|stim|stimi|isteam|esteam|estim|stean|stem)\b(?=\s|$)/g, 'Steam'],
  [/\b(dis cord|discorde|discordi|discod|discor)\b/g, 'Discord'],
  [/\b(v s code|ve esse code|vi es code|vies code|vs cod|vscode|visual studio code|ves code)\b/g, 'VS Code'],
  [/\b(geometri dash|geometria dash|geometric dash|geometry desh|geometri desh|geometria desh|geometry dash)\b/g, 'Geometry Dash'],
  [/\b(you tube|iutubi|iutube|iu tube|youtubi)\b/g, 'YouTube'],
  [/\b(git hub|guit hub|guithub|guit rub|github)\b/g, 'GitHub'],
  [/\b(spotfy|espotify|spot fai|spotifai)\b/g, 'Spotify'],
  [/\b(uatsap|whats app|uatizap|whatsap)\b/g, 'WhatsApp'],
  [/\b(chat gpt|chat gepete|chat jipiti|chatgpt)\b/g, 'ChatGPT'],
  [/\b(gimail|g mail|jimeil)\b/g, 'Gmail'],
  [/\b(control k|controle k|ctrl k)\b/g, 'Ctrl+K']
];

// Corrige a transcrição. Trabalha numa cópia sem acento para achar, e troca no texto original (mantém os acentos do resto).
export function fixSpeech(text) {
  let out = String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();   // NFC: posições iguais no texto e na cópia sem acento
  if (!out) return out;
  for (const [rx, to] of FIXES) {
    const f = fold(out);
    let m, acc = '', last = 0;
    rx.lastIndex = 0;
    while ((m = rx.exec(f))) { acc += out.slice(last, m.index) + to; last = m.index + m[0].length; if (!m[0].length) rx.lastIndex++; }
    out = acc + out.slice(last);
  }
  // "Jarvis" no começo, sozinho como chamado, não precisa estar no pedido (o resto é o pedido).
  return out.replace(/\s+/g, ' ').trim();
}

const VERBS = /^(?:jarvis\s+)?(abre|abra|abrir|entra|entre|inicia|inicie|cria|crie|escreve|pesquisa|procura|busca|clica|escolhe|toca|coloca|bota|olha|me|qual|quais|quanto|como|o que|que|marca|resume|le|lê|mostra|refina|melhora|muda|continua|para|cancela|confirmo|sim|nao|não)\b/;

// Escolhe o melhor palpite. candidates: [{ text, conf }], vocab: Set de palavras/expressões conhecidas (sem acento).
export function pickBest(candidates, vocab = new Set()) {
  const list = (candidates || []).map(c => ({ text: String(c?.text || '').trim(), conf: Number.isFinite(+c?.conf) ? Math.max(0, Math.min(1, +c.conf)) : 0 })).filter(c => c.text);
  if (!list.length) return null;
  const score = c => {
    const f = fold(fixSpeech(c.text));
    let hits = 0;
    for (const v of vocab) if (v.length >= 3 && ` ${f} `.includes(` ${v} `)) hits++;
    return c.conf + Math.min(.3, hits * .12) + (VERBS.test(f) ? .08 : 0);
  };
  return list.map(c => ({ ...c, score: score(c) })).sort((a, b) => b.score - a.score)[0];
}

// O pedido precisa de uma segunda opinião? (confiança baixa, ou curto demais para ser um pedido)
export function doubtful(best) {
  if (!best) return false;
  const words = best.text.split(/\s+/).length;
  return best.conf > 0 && best.conf < .62 || (words <= 2 && best.conf < .8 && !VERBS.test(fold(best.text)));
}

// A IA ouve o áudio (WAV 16 kHz) e devolve só o que foi dito. hints: nomes que o usuário costuma falar.
const WAV = /^data:audio\/wav;base64,([A-Za-z0-9+/=]+)$/;
export async function transcribe(generate, models, { audio, chrome = '', hints = [] }) {
  const m = WAV.exec(String(audio || ''));
  if (!m) throw Object.assign(new Error('Áudio inválido.'), { code: 400 });
  const r = await generate(models, models.levels.tech ? 'tech' : models.defaultLevel, {
    json: true, maxTokens: 300,
    system: `Você transcreve um pedido de voz em português do Brasil feito ao assistente ${ASSISTANT_NAME}. Escreva EXATAMENTE o que foi dito, sem completar nem corrigir o sentido.\n` +
      'Nomes que o usuário costuma falar (use a grafia certa quando ouvir algo parecido): ' + hints.slice(0, 80).join(', ') + '.\n' +
      'Se não houver fala clara, devolva texto vazio. Responda SOMENTE JSON: {"texto":"..."}',
    messages: [{ role: 'user', content: chrome ? `O reconhecimento do navegador entendeu: "${String(chrome).slice(0, 200)}" (pode estar errado).` : 'Transcreva o áudio.', audio: { mime: 'audio/wav', data: m[1] } }],
    validate: x => { if (typeof x?.texto !== 'string') throw new Error('x'); return x; }
  });
  return String(r.data?.texto || '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}
