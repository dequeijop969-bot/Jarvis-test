// Saudação: se a agenda de hoje tem algo em que o modo Code ajuda ("Entrega do site", "Estudar Python",
// "Apresentação do projeto"), o JARVIS já separa a tarefa e os apps necessários. Abrir os apps é com um toque
// ("Preparar") ou dizendo "prepara"; fazer a tarefa é com "Fazer no modo Code".
import { parseOpen } from './launcher.js';
import { addressing } from './profile.js';
import { PERSONA } from './assistant.js';

const str = (v, n) => String(v ?? '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Valida o que a IA devolveu: só apps que o Jarvis sabe abrir (mesma regra do "abre o ..."), no máximo 2 planos e 4 apps.
export function cleanPlan(x, events) {
  const titles = new Set(events.map(e => e.title));
  const list = Array.isArray(x?.planos) ? x.planos : [];
  return list.slice(0, 2).map(p => {
    const evento = str(p?.evento, 80);
    const apps = [], seen = new Set();
    for (const a of Array.isArray(p?.apps) ? p.apps : []) {
      const t = parseOpen(`abre ${str(a, 40)}`);
      if (!t || t.key === 'search' || seen.has(t.label)) continue;
      seen.add(t.label); apps.push({ name: str(a, 40), label: t.label });
      if (apps.length >= 4) break;
    }
    return { evento, hora: events.find(e => e.title === evento)?.start || '', tarefa: str(p?.tarefa, 160), pedido: str(p?.pedido, 300), apps };
  }).filter(p => titles.has(p.evento) && p.tarefa && (p.apps.length || p.pedido));
}

export async function planFromAgenda(generate, models, profile, events) {
  const todo = (events || []).filter(e => !e.past).slice(0, 6);
  if (!todo.length) return [];
  const a = addressing(profile);
  const r = await generate(models, (models.levels.tech ? 'tech' : (profile?.level || models.defaultLevel)), {
    maxTokens: 700, validate: x => cleanPlan(x, todo),
    system: `Você é o JARVIS. ${a.rule}
${PERSONA}

Olhe os compromissos de hoje e encontre os que o modo Code pode adiantar. No modo Code, o Jarvis Code (ajudante na tela) abre apps e sites, escreve código e arquivos novos no VS Code, pesquisa, escolhe e clica em coisas na tela e instala jogos da Steam.
Ex.: "Entrega do site da padaria" → criar o index.html no VS Code, apps: vs code, chrome. "Estudar Python" → abrir um tutorial e criar exercicios.py, apps: vs code, youtube. "Reunião com o cliente" → abrir o Google Meet/agenda, apps: chrome. Compromissos pessoais sem relação com computador (dentista, almoço): ignore.
Responda SOMENTE JSON: {"planos":[{"evento":"título EXATO do compromisso","tarefa":"o que você já separou para ele, 1 frase curta","pedido":"o pedido pronto para o modo Code fazer a tarefa (ex.: abre o VS Code e cria um index.html da padaria com cardápio)","apps":["nomes curtos: vs code, chrome, youtube, spotify, steam, bloco de notas, gmail, github..."]}]}. No máximo 2 planos. Nenhum compromisso serve: {"planos":[]}.`,
    messages: [{ role: 'user', content: 'Compromissos de hoje:\n' + todo.map(e => `- ${e.allDay ? 'dia todo' : e.start}: ${e.title}`).join('\n') }]
  });
  return r.data || [];
}

const join = xs => xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`;
export function planSpeech(plans, a) {
  if (!plans.length) return '';
  const each = plans.map(p => `Para ${p.evento}${p.hora ? `, às ${p.hora}` : ''}, já separei: ${p.tarefa.replace(/\.$/, '')}${p.apps.length ? `, com ${join(p.apps.map(x => x.label))}` : ''}.`);
  return `${each.join(' ')} Diga "prepara" e eu abro tudo, ${a.short}, ou toque em Fazer no modo Code. O trabalho braçal fica com o Jarvis Code, naturalmente.`;
}
