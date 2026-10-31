// WhatsApp pela Cloud API oficial da Meta: o Jarvis manda mensagens do número de envio configurado (não lê as suas conversas).
// .env: WHATSAPP_TOKEN (token de acesso), WHATSAPP_PHONE_ID (ID do número de envio, no painel da Meta). Opcionais:
// WHATSAPP_MEU_NUMERO (recebe os lembretes do Jarvis) e WHATSAPP_TEMPLATE (modelo aprovado com um campo {{1}}, usado quando a
// pessoa não falou com o número nas últimas 24 h, regra da Meta). Toda mensagem pede confirmação antes de sair.
import { readJSON, writeJSON } from './store.js';
import { registerSecret } from './secrets.js';

const API = 'https://graph.facebook.com/v21.0';
const FILE = 'whatsapp.json';
const env = k => (process.env[k] || '').trim();
const cfg = () => { const t = env('WHATSAPP_TOKEN'); if (t) registerSecret(t); return { token: t, phone: env('WHATSAPP_PHONE_ID'), me: env('WHATSAPP_MEU_NUMERO'), template: env('WHATSAPP_TEMPLATE'), lang: env('WHATSAPP_TEMPLATE_LANG') || 'pt_BR' }; };
export const configured = () => !!(cfg().token && /^\d{6,20}$/.test(cfg().phone));
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, n) : '');

/* ---------- contatos (data/whatsapp.json) ---------- */
// Número só com dígitos, com DDI: 11 91234-5678 vira 5511912345678 (sem DDI, assume Brasil).
export function normalize(n) {
  const intl = /^\s*(\+|00)/.test(String(n || ''));
  let d = String(n || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!intl && (d.length === 10 || d.length === 11)) d = '55' + d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}
export const pretty = d => d.startsWith('55') && d.length >= 12 ? `+55 ${d.slice(2, 4)} ${d.slice(4, -4)}-${d.slice(-4)}` : '+' + d;
export const contacts = () => readJSON(FILE, { contatos: [] }).contatos || [];
export function addContact(nome, numero) {
  const n = str(nome, 40), d = normalize(numero);
  if (!n) throw Object.assign(new Error('Dê um nome ao contato.'), { code: 400 });
  if (!d) throw Object.assign(new Error('Número inválido. Use DDD e número, ex.: 11 91234-5678.'), { code: 400 });
  const list = contacts().filter(c => fold(c.nome) !== fold(n));
  if (list.length >= 100) throw Object.assign(new Error('Limite de 100 contatos.'), { code: 429 });
  list.push({ nome: n, numero: d });
  list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  writeJSON(FILE, { contatos: list });
  return list;
}
export function removeContact(i) {
  const list = contacts();
  if (!Number.isInteger(i) || i < 0 || i >= list.length) throw Object.assign(new Error('Contato não encontrado.'), { code: 404 });
  list.splice(i, 1); writeJSON(FILE, { contatos: list });
  return list;
}
// "João", "o joão", "joao silva" ou um número falado/digitado.
export function resolve(to, list = contacts()) {
  const d = normalize(to);
  if (d && String(to).replace(/\D/g, '').length >= 10) return { nome: pretty(d), numero: d };
  const q = fold(to).replace(/^(o|a|os|as|meu|minha|pro|pra|para) /, '');
  if (!q) return null;
  return list.find(c => fold(c.nome) === q) || list.find(c => fold(c.nome).split(' ')[0] === q) || list.find(c => fold(c.nome).startsWith(q)) || null;
}

export function status() {
  const c = cfg(), n = contacts().length;
  if (!configured()) return { state: 'off', configured: false, message: 'Coloque WHATSAPP_TOKEN e WHATSAPP_PHONE_ID no .env.', contatos: contacts().map(x => ({ nome: x.nome, numero: pretty(x.numero) })) };
  return { state: 'on', configured: true, message: `Pronto para enviar · ${n} contato${n === 1 ? '' : 's'}${c.me ? ' · lembretes no seu WhatsApp' : ''}`, contatos: contacts().map(x => ({ nome: x.nome, numero: pretty(x.numero) })) };
}

/* ---------- envio ---------- */
async function post(body) {
  const c = cfg();
  const r = await fetch(`${API}/${c.phone}/messages`, { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', ...body }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.messages?.[0]?.id) return j.messages[0].id;
  const code = j.error?.code, sub = j.error?.error_subcode;
  throw Object.assign(new Error(
    code === 190 ? 'O token do WhatsApp expirou ou é inválido. Gere outro no painel da Meta e troque no .env.'
      : code === 131030 ? 'Esse número não está na lista de teste do WhatsApp. Adicione-o no painel da Meta (até 5 números no modo de teste).'
      : code === 131047 ? 'Essa pessoa não falou com o número do Jarvis nas últimas 24 horas, e o WhatsApp só deixa mandar texto livre dentro dessa janela.'
      : code === 131026 ? 'Esse número não tem WhatsApp.'
      : code === 100 && /phone/i.test(j.error?.message || '') ? 'O WHATSAPP_PHONE_ID do .env não confere com o painel da Meta.'
      : r.status === 429 || code === 130429 ? 'O WhatsApp pediu um tempo. Tente em instantes.'
      : `O WhatsApp recusou a mensagem${code ? ` (erro ${code}${sub ? '/' + sub : ''})` : ''}.`), { code: r.status === 429 ? 429 : 502, wa: code });
}
// Celular do Brasil chega do WhatsApp sem o 9 (55 11 8765-4321); a lista de teste da Meta só aceita com o 9.
export const br9 = d => (/^55\d{2}[6-9]\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d);
// Texto livre; fora da janela de 24 h usa o modelo aprovado (WHATSAPP_TEMPLATE), se houver.
export async function send(to, text) {
  if (!configured()) throw Object.assign(new Error('O WhatsApp não está configurado.'), { code: 409 });
  const d = br9(normalize(to)), body = str(text, 1000);
  if (!d || !body) throw Object.assign(new Error('Faltou o número ou a mensagem.'), { code: 400 });
  try { return { id: await post({ to: d, type: 'text', text: { body, preview_url: false } }), via: 'texto' }; }
  catch (e) {
    const c = cfg();
    if (e.wa !== 131047 || !c.template) throw e;
    return { id: await post({ to: d, type: 'template', template: { name: c.template, language: { code: c.lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: body }] }] } }), via: 'modelo' };
  }
}
// Confere o token e o número de envio (Ajustes > Testar).
export async function test() {
  if (!configured()) throw Object.assign(new Error('Coloque WHATSAPP_TOKEN e WHATSAPP_PHONE_ID no .env.'), { code: 409 });
  const c = cfg();
  const r = await fetch(`${API}/${c.phone}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.code === 190 ? 'Token inválido ou expirado.' : 'O painel da Meta não reconheceu esse número de envio.'), { code: 502 });
  return { numero: j.display_phone_number || '', nome: j.verified_name || '' };
}
// Lembretes do Jarvis também no seu WhatsApp (WHATSAPP_MEU_NUMERO).
export const myNumber = () => (configured() ? normalize(cfg().me) : '');

/* ---------- pedido falado ---------- */
// "manda no zap pro João que chego às 8", "envia uma mensagem no WhatsApp para a Ana dizendo bom dia",
// "avisa o Pedro pelo whats que o arquivo está pronto". Sem a palavra WhatsApp/zap, não é com ele.
const WA = '(?:whats\\s?app|whats|zap(?:zap)?|wpp)';
const RX = new RegExp(`^(?:jarvis[,\\s]+)?(?:manda|mande|mandar|envia|envie|enviar|escreve|escreva|avisa|avise|fala|fale|diz|diga)\\s+(?:(?:uma?|um)\\s+)?(?:mensagem|msg|recado|mensagenzinha)?\\s*(?:(?:no|pelo|via|pelo meu)\\s+${WA}\\s+)?(?:para|pra|pro|ao|à|a|o)?\\s*(?:o\\s+|a\\s+)?(.+?)\\s*(?:(?:no|pelo|via)\\s+${WA}\\s*)?(?:,?\\s*(?:dizendo|falando|escrevendo|avisando)(?:\\s+que)?|\\s+que|:|,|\\s+-)\\s*(.+)$`, 'i');
export function parse(text) {
  const s = String(text || '').trim().replace(/[.!]+$/, '');
  if (!new RegExp(`\\b${WA}\\b`, 'i').test(s)) return null;
  const m = s.match(RX);
  if (!m) return null;
  const to = m[1].replace(new RegExp(`\\s*(?:no|pelo|via)\\s+${WA}$`, 'i'), '').trim();
  const msg = m[2].replace(new RegExp(`\\s*(?:no|pelo|via)\\s+${WA}$`, 'i'), '').trim();
  if (!to || to.split(/\s+/).length > 5) return null;
  return { to, text: msg.charAt(0).toUpperCase() + msg.slice(1) };
}
