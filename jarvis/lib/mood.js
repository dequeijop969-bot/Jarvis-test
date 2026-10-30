// Expressões do Jarvis Code (feliz, triste, bravo, surpreso, confuso, apaixonado, tonto): o servidor escolhe uma
// pelo que o usuário disse, pelo resultado do pedido ou pelo que a IA viu na tela, e manda o evento "emocao"
// para o Jarvis Desktop. Ele só faz a cara quando está parado (nunca atrapalha uma tarefa).
// Nada aqui observa a tela por conta própria: a tela só é vista quando o usuário pede.
export const MOODS = ['feliz', 'triste', 'bravo', 'surpreso', 'confuso', 'apaixonado', 'tonto'];
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// O que o usuário disse para (ou sobre) o Jarvis. Ordem importa: "te amo" vence "obrigado".
const TEXT = [
  ['apaixonado', /\b(te amo|amo voce|eu te adoro|te adoro|casa comigo|fofo|fofinho|lindo|lindinho|gatinho|meu amor|crush|beijo|beijinho|coracao)\b/],
  ['bravo', /\b(burro|idiota|inutil|lixo|imbecil|otario|estupido|cala a boca|cala boca|lerdo|porcaria|bosta)\b/],
  ['tonto', /\b(da um mortal|faz um mortal|da uma cambalhota|gira|rodopia|da uma volta|faz um pião|faz um piao|bebado|bebeu)\b/],
  ['triste', /\b(tchau|adeus|vou embora|ate amanha|ate mais|vou sair|vou dormir|te odeio|nao gosto de voce|desinstalar voce|vou te desligar)\b/],
  ['surpreso', /\b(nossa|caramba|uau|wow|eita|meu deus|nao acredito|mentira|serio mesmo|surpresa|adivinha)\b/],
  ['feliz', /\b(valeu|obrigad[oa]|brigad[oa]|bom trabalho|mandou bem|perfeito|incrivel|top|show|parabens|genio|excelente|maravilha|muito bem|isso ai|boa jarvis|ganhei|passei)\b/]
];
export function fromText(text) {
  const t = ` ${fold(text)} `;
  for (const [m, rx] of TEXT) if (rx.test(t)) return m;
  return null;
}

// O resultado do pedido (o que voltou do /api/chat).
export function fromReply(out) {
  if (!out || typeof out !== 'object') return null;
  if (MOODS.includes(out.emotion)) return out.emotion;                   // a IA escolheu ao olhar a tela
  const st = out.task?.status;
  if (st === 'ok') return 'feliz';
  if (st === 'preso' || st === 'limite') return 'tonto';                 // rodou em círculos
  if (st && st !== 'cancelado') return 'triste';                         // desistiu, erro, tempo
  if (out.mcp) return out.mcp.ok ? 'feliz' : 'confuso';
  if (out.written || out.steam?.play) return 'feliz';
  if (/^(nao consegui entender|nao entendi|nao achei qual|nao encontrei)/.test(fold(out.intro))) return 'confuso';
  return null;
}

// Fim de uma partida: jogou muito tempo, sai tonto; pouco, feliz.
export const fromGame = done => done?.why === 'erro' ? 'triste' : done?.seconds >= 60 ? 'tonto' : 'feliz';

// Na tela: a IA termina a resposta com [[emocao:nome]] quando algo merece uma cara. Tira a marca do texto falado.
export const SCREEN_RULE = 'Depois da resposta, se algo na tela merecer uma reação do Jarvis Code (o ajudante em pixel art), acrescente no FIM, sozinho, [[emocao:NOME]] com UM destes nomes: ' +
  'apaixonado (a foto de uma mulher ou de alguém bonito, um casal, um coração, um bichinho fofo), feliz (uma vitória, conquista, nota boa, "deu certo", algo engraçado), ' +
  'triste (tela de erro, game over, derrota, tela azul, notícia ruim), bravo (propaganda invasiva, golpe, vírus, spam), surpreso (algo impressionante ou inesperado), ' +
  'confuso (código bagunçado, erro incompreensível, tela muito estranha), tonto (tela lotada de janelas, abas e notificações). Se nada se destacar, não acrescente nada.';
export function splitScreenMood(text) {
  const s = String(text || '');
  const m = s.match(/\[\[\s*emo[cç][aã]o\s*:\s*([a-zç]+)\s*\]\]/i);
  const mood = m && MOODS.includes(fold(m[1])) ? fold(m[1]) : null;
  return { text: s.replace(/\[\[[^\]]*\]\]/g, ' ').replace(/\s+/g, ' ').trim(), mood };
}

// Escolha final: tela > o que o usuário disse > resultado. Quanto tempo cada cara fica.
const SECS = { feliz: 2.2, triste: 3, bravo: 2.6, surpreso: 1.4, confuso: 3, apaixonado: 3.2, tonto: 3 };
export function pick(text, out) {
  const m = (MOODS.includes(out?.emotion) && out.emotion) || fromText(text) || fromReply(out);
  return m ? { nome: m, segundos: SECS[m] } : null;
}
