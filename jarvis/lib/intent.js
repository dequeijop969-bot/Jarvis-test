// Quando há arquivo no contexto (anexo, um arquivo entregue há pouco, ou o modo Code), a IA lê a conversa e decide o que
// você quer: criar um arquivo, editar um (qual), mexer no código do projeto, ou só conversar. Assim "tá bom, mas tá sem
// as cores" ou "refaz isso mais caprichado" funcionam sem depender de uma lista de palavras. Fora disso (conversa comum)
// não há chamada a mais. Se a IA não responder, quem decide é a lista de palavras (filemaker.detect), como antes.
const ACOES = new Set(['criar', 'editar', 'codigo', 'gerenciar', 'conversa']);
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Fala de arquivos/pastas do computador ("cria uma pasta na área de trabalho", "o que tem nos downloads?").
const DEVICE_RX = /\b(area de trabalho|desktop|pastas?|downloads?|meus documentos|documentos|arquivos?|renomeia|renomear|organiza|organizar)\b/;
export const mentionsDevice = text => DEVICE_RX.test(fold(text));
const ALVOS = new Set(['anexo', 'ultimo', 'projeto', 'nenhum']);
const str = (v, n) => String(v ?? '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Vale a pena perguntar à IA? Só com arquivo no contexto.
export const worth = ({ files = 0, recent = null, code = false, device = false } = {}) => files > 0 || !!recent || code || device;

export function clean(d) {
  const acao = String(d?.acao || '').toLowerCase(), arquivo = String(d?.arquivo || 'nenhum').toLowerCase();
  if (!ACOES.has(acao)) throw new Error('acao');
  return { acao, arquivo: ALVOS.has(arquivo) ? arquivo : 'nenhum' };
}

const ago = ms => { const m = Math.round(ms / 60_000); return m < 1 ? 'agora há pouco' : `há ${m} min`; };

export async function decide(generate, models, { text, history = [], files = [], recent = null, mode = 'normal', workspace = null, now = Date.now() }) {
  const ctx = [
    `Modo: ${mode === 'code' ? 'Code (o Jarvis Code escreve código no VS Code)' : 'normal'}${mode === 'code' ? (workspace ? `; pasta de projeto aberta: "${str(workspace, 60)}"` : '; sem pasta de projeto aberta') : ''}.`,
    files.length ? `Anexos desta mensagem: ${files.map(f => `${f.kind} "${str(f.name, 60)}"`).join('; ')}.` : 'Sem anexos nesta mensagem.',
    recent ? `Último arquivo que o Jarvis entregou no correio: "${str(recent.name, 80)}" (${ago(now - recent.at)}).` : 'Nenhum arquivo entregue recentemente.',
  ].join('\n');
  const conversa = history.slice(-4).map(m => `${m.role === 'user' ? 'Usuário' : 'Jarvis'}: ${str(m.content, 300)}`).join('\n');
  const r = await generate(models, models.levels['2.5'] ? '2.5' : models.defaultLevel, {
    maxTokens: 120, timeout: 8000,
    validate: clean,
    system: `CLASSIFICADOR DE PEDIDOS do assistente Jarvis. Leia o contexto e a última mensagem do usuário e diga o que ele quer.
acao:
- "criar": quer um arquivo NOVO (PDF, planilha, documento, página, script...) entregue no correio.
- "editar": quer alterar/refazer/melhorar um arquivo que já existe (o anexo, ou o último que o Jarvis entregou), mesmo sem dizer "arquivo" ("tá sem as cores", "refaz mais bonito", "aumenta a letra", "tira a segunda página").
- "codigo": quer mexer no código da pasta de projeto aberta no VS Code (só no modo Code com pasta aberta, ou se pedir "no VS Code"). PDF, planilha e documentos NUNCA são código.
- "gerenciar": quer mexer em arquivos/pastas que JÁ EXISTEM no computador: listar o que tem numa pasta, criar uma pasta vazia, mover, renomear, organizar, mandar para a lixeira ("o que tem na minha área de trabalho?", "cria uma pasta Faculdade nos documentos", "move os PDFs dos downloads para a pasta Contas", "apaga o arquivo teste.txt da área de trabalho"). Criar um arquivo NOVO com conteúdo (mesmo "na área de trabalho") é "criar".
- "conversa": qualquer outra coisa (pergunta, comentário, abrir app, música, e-mail, agenda, "o que tem nesse arquivo?").
arquivo (o que vai ser editado, ou de onde vêm os dados do arquivo novo, como em "faz uma planilha com esses eventos"): "anexo" (o que veio nesta mensagem), "ultimo" (o último entregue no correio), "projeto" (um arquivo do projeto), "nenhum".
Responda SOMENTE JSON: {"acao":"...","arquivo":"..."}`,
    messages: [{ role: 'user', content: `${ctx}\n\nConversa recente:\n${conversa || '(nenhuma)'}\n\nÚltima mensagem do usuário: ${str(text, 600)}` }],
  });
  return r.data || null;
}
