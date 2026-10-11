// Abrir apps e sites por pedido de voz. Só ABRE (não fecha, não clica, não digita).
// Segurança: nada vindo do texto vira comando. Apps só de uma lista fixa ou cadastrados por você na interface;
// sites só http/https (nomes conhecidos, um domínio dito em voz ou uma pesquisa no Google). Sem shell com texto do usuário.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON } from './store.js';

export const OPEN = { spawn, exists: fs.existsSync, platform: process.platform, autoRefresh: false }; // trocáveis nos testes (autoRefresh: o servidor liga ao subir)
const FILE = 'apps.json';
const env = k => process.env[k] || '';
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();

// Sites conhecidos (nome falado → endereço).
export const SITES = {
  youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', 'meu email': 'https://mail.google.com', google: 'https://www.google.com',
  whatsapp: 'https://web.whatsapp.com', 'whatsapp web': 'https://web.whatsapp.com', github: 'https://github.com', netflix: 'https://www.netflix.com',
  instagram: 'https://www.instagram.com', facebook: 'https://www.facebook.com', twitter: 'https://x.com', x: 'https://x.com', linkedin: 'https://www.linkedin.com',
  'google drive': 'https://drive.google.com', drive: 'https://drive.google.com', 'google agenda': 'https://calendar.google.com', 'google calendar': 'https://calendar.google.com',
  'google maps': 'https://maps.google.com', maps: 'https://maps.google.com', mapa: 'https://maps.google.com', tradutor: 'https://translate.google.com', 'google tradutor': 'https://translate.google.com',
  'google docs': 'https://docs.google.com', 'google planilhas': 'https://sheets.google.com', notion: 'https://www.notion.so', figma: 'https://www.figma.com', canva: 'https://www.canva.com',
  amazon: 'https://www.amazon.com.br', 'mercado livre': 'https://www.mercadolivre.com.br', g1: 'https://g1.globo.com', globo: 'https://www.globo.com', twitch: 'https://www.twitch.tv',
  reddit: 'https://www.reddit.com', wikipedia: 'https://pt.wikipedia.org', claude: 'https://claude.ai', chatgpt: 'https://chatgpt.com', 'spotify web': 'https://open.spotify.com',
  'prime video': 'https://www.primevideo.com', 'disney plus': 'https://www.disneyplus.com', tiktok: 'https://www.tiktok.com', pinterest: 'https://br.pinterest.com', outlook: 'https://outlook.live.com'
};

const PRETTY = { youtube: 'o YouTube', gmail: 'o Gmail', 'meu email': 'o Gmail', whatsapp: 'o WhatsApp', 'whatsapp web': 'o WhatsApp', github: 'o GitHub', linkedin: 'o LinkedIn',
  tiktok: 'o TikTok', chatgpt: 'o ChatGPT', g1: 'o g1', x: 'o X', twitter: 'o X', 'google drive': 'o Google Drive', drive: 'o Google Drive', 'google maps': 'o Google Maps', maps: 'o Google Maps', mapa: 'o Google Maps',
  wikipedia: 'a Wikipédia', amazon: 'a Amazon', 'google agenda': 'a Google Agenda', 'prime video': 'o Prime Video', 'disney plus': 'o Disney+', 'spotify web': 'o Spotify' };

// Apps do Windows (nome falado → como abrir). "start" só recebe nomes desta lista fixa, nunca texto do usuário.
function chromePath() {
  const c = [path.join(env('ProgramFiles'), 'Google/Chrome/Application/chrome.exe'), path.join(env('ProgramFiles(x86)'), 'Google/Chrome/Application/chrome.exe'), path.join(env('LOCALAPPDATA'), 'Google/Chrome/Application/chrome.exe')];
  return c.find(p => p && OPEN.exists(p)) || null;
}
const START = n => ({ cmd: 'cmd.exe', args: ['/d', '/c', 'start', '', n] }); // '' vira o título vazio do start
const EXPL = target => ({ cmd: 'explorer.exe', args: [target] });
export const APPS = {
  chrome: () => (chromePath() ? { cmd: chromePath(), args: [] } : START('chrome')), 'google chrome': () => APPS.chrome(), navegador: () => APPS.chrome(),
  edge: () => START('msedge'), 'microsoft edge': () => START('msedge'), firefox: () => START('firefox'),
  'bloco de notas': () => ({ cmd: 'notepad.exe', args: [] }), notepad: () => ({ cmd: 'notepad.exe', args: [] }),
  calculadora: () => START('calc'), paint: () => START('mspaint'), 'explorador de arquivos': () => EXPL(env('USERPROFILE') || 'C:\\'), arquivos: () => EXPL(env('USERPROFILE') || 'C:\\'),
  'meus documentos': () => EXPL(path.join(env('USERPROFILE'), 'Documents')), downloads: () => EXPL(path.join(env('USERPROFILE'), 'Downloads')),
  configuracoes: () => EXPL('ms-settings:'), 'configuracoes do windows': () => EXPL('ms-settings:'),
  spotify: () => EXPL('spotify:'),
  // Discord: o atalho oficial (Update.exe --processStart) abre e também traz da bandeja; o "discord:" sozinho às vezes não faz nada.
  discord: () => { const u = path.join(env('LOCALAPPDATA'), 'Discord/Update.exe'); return OPEN.exists(u) ? { cmd: u, args: ['--processStart', 'Discord.exe'] } : EXPL('discord://-/channels/@me'); }, steam: () => EXPL('steam://open/main'), whatsapp_app: () => EXPL('whatsapp:'),
  'vs code': () => { const p = path.join(env('LOCALAPPDATA'), 'Programs/Microsoft VS Code/Code.exe'); return OPEN.exists(p) ? { cmd: p, args: [] } : START('code'); },
  vscode: () => APPS['vs code'](), 'visual studio code': () => APPS['vs code'](),
  word: () => START('winword'), excel: () => START('excel'), powerpoint: () => START('powerpnt'), outlook_app: () => START('outlook'),
  'loja da microsoft': () => EXPL('ms-windows-store:'), relogio: () => EXPL('ms-clock:'), camera: () => EXPL('microsoft.windows.camera:'), 'captura de tela': () => EXPL('ms-screenclip:')
};
const LABEL = { chrome: 'o Chrome', 'bloco de notas': 'o Bloco de Notas', calculadora: 'a Calculadora', 'explorador de arquivos': 'o Explorador de Arquivos', arquivos: 'o Explorador de Arquivos',
  configuracoes: 'as Configurações', 'vs code': 'o VS Code', vscode: 'o VS Code', spotify: 'o Spotify', whatsapp_app: 'o WhatsApp', discord: 'o Discord', steam: 'a Steam' };

/* ---------- Apps cadastrados por você (Integrações → Abrir apps) ---------- */
export const customApps = () => (readJSON(FILE, []) || []).filter(a => a && a.name && a.path);
export function addApp(name, p) {
  const n = norm(name).slice(0, 40), file = String(p || '').trim().replace(/^"|"$/g, '');
  if (n.length < 2) throw Object.assign(new Error('Dê um nome ao app (como você vai falar).'), { code: 400 });
  if (!path.isAbsolute(file) || !/\.(exe|lnk|url|appref-ms)$/i.test(file)) throw Object.assign(new Error('Use o caminho completo de um .exe ou de um atalho (.lnk).'), { code: 400 });
  if (!OPEN.exists(file)) throw Object.assign(new Error('Não encontrei esse arquivo. Confira o caminho.'), { code: 400 });
  const list = customApps().filter(a => a.name !== n).concat({ name: n, path: file }).slice(-40);
  writeJSON(FILE, list); return list;
}
export function removeApp(name) { const n = norm(name), list = customApps().filter(a => a.name !== n); writeJSON(FILE, list); return list; }

/* ---------- Apps instalados (a lista do menu Iniciar do Windows, a mesma do Get-StartApps) ----------
   Inclui apps da Microsoft Store e jogos com atalho. Lida ao iniciar o servidor e de novo a cada 30 min
   (ou quando um nome não é achado). Desinstaladores, ajuda, sites e links ficam de fora. */
let installed = [], installedAt = 0, loading = null, lastTry = 0;
const JUNK = /\b(uninstall|desinstal\w*|remov\w*|support|suporte|help|ajuda|readme|leia me|website|documentation|documentacao|manual|release notes|license|licenca|feedback|repair|reparar)\b/;
OPEN.listApps = () => new Promise((ok, fail) => {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return fail(err);
      try { const j = JSON.parse(String(out).trim() || '[]'); ok((Array.isArray(j) ? j : [j]).map(a => ({ name: a.Name, id: a.AppID }))); } catch (e) { fail(e); }
    });
});
export function refreshInstalled(force = false) {
  if (OPEN.platform !== 'win32') return Promise.resolve([]);
  if (loading) return loading;
  if (!force && Date.now() - lastTry < 60_000) return Promise.resolve(installed);   // no máximo 1 leitura por minuto
  lastTry = Date.now();
  loading = OPEN.listApps().then(list => {
    installed = list.filter(a => a && typeof a.name === 'string' && typeof a.id === 'string' && !/^https?:/i.test(a.id) && !JUNK.test(norm(a.name)))
      .map(a => ({ name: a.name.slice(0, 80), id: a.id, n: norm(a.name) }));
    installedAt = Date.now(); return installed;
  }).catch(() => installed).finally(() => { loading = null; });
  return loading;
}
export const installedApps = () => installed.map(({ name, id }) => ({ name, id }));

// Acha o app pelo nome falado: igual, começa com, todas as palavras, ou o nome dentro da frase ("o jogo valorant").
export function findInstalled(q) {
  if (OPEN.autoRefresh && Date.now() - installedAt > 30 * 60_000) refreshInstalled();
  const n = norm(q);
  if (n.length < 2 || !installed.length) return null;
  const words = n.split(' ');
  let best = null, bestScore = 0;
  for (const a of installed) {
    const aw = a.n.split(' ');
    let s = 0;
    if (a.n === n) s = 100;
    else if (n.length >= 3 && a.n.startsWith(n + ' ')) s = 85;
    else if (n.length >= 3 && words.every(w => aw.includes(w))) s = 75;
    else if (n.length >= 4 && aw[0].startsWith(n)) s = 60;
    else if (a.n.length >= 4 && ` ${n} `.includes(` ${a.n} `)) s = 55;
    if (s > bestScore || (s && s === bestScore && a.n.length < best.n.length)) { best = a; bestScore = s; }
  }
  return best;
}

/* ---------- Entender o pedido ---------- */
const VERB = /^(?:(?:jarvis|por favor|pode|voce pode|consegue|me|da pra|tem como)\s+)*(abre|abra|abrir|abri|inicia|inicie|iniciar|executa|execute|liga|ligue|bota|coloca|entra|entre|acessa|acesse|vai|va)\b\s*/;
const DOMAIN = /^((?:[a-z0-9-]+\.)+(?:com|br|org|net|io|ai|dev|app|gov|edu|tv|me|co|info|xyz|gg)(?:\.[a-z]{2})?)$/;
// Devolve { type: 'app'|'url', key, label, url? } ou null (não é um pedido de abrir).
export function parseOpen(text) {
  let t = norm(text).replace(/\b(por favor|pra mim|para mim|ai|agora|rapidinho)\b/g, ' ').replace(/\s+/g, ' ').trim();
  // "pesquisa no google X" / "pesquisa X no google" (imagens já foram tratadas antes)
  let m = t.match(/^(?:(?:jarvis|pode|me)\s+)*(?:pesquis\w*|procur\w*|busc\w*|googl\w*)\s+(?:no google|na internet|no chrome)\s+(?:sobre\s+|por\s+)?(.{2,120})$/) || t.match(/^(?:(?:jarvis|pode|me)\s+)*(?:pesquis\w*|procur\w*|busc\w*)\s+(.{2,120}?)\s+(?:no google|no chrome)$/);
  if (m) return { type: 'url', key: 'search', label: `a pesquisa por "${m[1]}"`, url: `https://www.google.com/search?q=${encodeURIComponent(m[1])}` };
  m = t.match(VERB);
  if (!m) return null;
  let rest = t.slice(m[0].length).replace(/^(o|a|os|as|um|uma|no|na|meu|minha|pra mim)\s+/, '').trim();
  const inChrome = /\b(no|pelo|com o) (chrome|navegador)\b/.test(rest);
  rest = rest.replace(/\s+(no|pelo|com o) (chrome|navegador|google)$/, '').trim();
  // "abre uma (nova) guia/aba (do|com|no|em) X"
  const tab = rest.match(/^(?:nova\s+)?(?:guia|aba|janela)(?:\s+nova)?(?:\s+(?:do|da|de|com|no|na|em|pra|para|pesquisando|sobre)\s+(?:o\s+|a\s+)?(.+))?$/);
  if (tab) {
    const q = (tab[1] || '').trim();
    if (!q) return { type: 'url', key: 'newtab', label: 'uma nova guia', url: 'https://www.google.com' };
    return siteOrSearch(q, true);
  }
  rest = rest.replace(/^(site|pagina|app|aplicativo|programa|jogo|game)\s+(do|da|de)?\s*/, '').trim();
  const custom = customApps().find(a => a.name === rest);
  if (custom) return { type: 'custom', key: custom.name, label: custom.name, path: custom.path };
  const appKey = rest === 'whatsapp' && !inChrome ? null : rest === 'outlook' ? null : Object.keys(APPS).find(k => k === rest);
  if (appKey) return { type: 'app', key: appKey, label: LABEL[appKey] || appKey };
  // Sites conhecidos e domínios vêm antes; depois, qualquer app instalado (lista do menu Iniciar), sem precisar cadastrar.
  const site = siteOrSearch(rest, inChrome);
  if (site && site.key !== 'search') return site;
  const inst = inChrome ? null : findInstalled(rest);
  if (inst) return { type: 'installed', key: inst.id, label: inst.name };
  if (OPEN.autoRefresh && !inChrome && rest.length >= 2) refreshInstalled();   // app instalado agora? a lista se atualiza para a próxima vez
  return site;
}
function siteOrSearch(q, allowSearch) {
  q = q.replace(/\s+ponto\s+/g, '.').replace(/\s+/g, ' ').trim();
  if (SITES[q]) return { type: 'url', key: q, label: PRETTY[q] || 'o ' + q.replace(/(^|\s)\S/g, c => c.toUpperCase()), url: SITES[q] };
  const d = q.replace(/\s/g, '').match(DOMAIN);
  if (d) return { type: 'url', key: d[1], label: d[1], url: `https://${d[1]}` };
  if (allowSearch && q.length >= 2) return { type: 'url', key: 'search', label: `a pesquisa por "${q}"`, url: `https://www.google.com/search?q=${encodeURIComponent(q)}` };
  return null;
}

/* ---------- Abrir ---------- */
function run(cmd, args) {
  return new Promise((ok, fail) => {
    let child;
    try { child = OPEN.spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, shell: false }); } catch (e) { return fail(e); }
    child.once('error', fail);
    setTimeout(() => { child.unref?.(); ok(); }, 150);
  });
}
// Modo Code sem o mascote: abre no VS Code um arquivo que o próprio Jarvis criou (pasta Jarvis Code), sem shell.
export async function openInEditor(dir, file) {
  if (OPEN.platform !== 'win32') throw Object.assign(new Error('Abrir o VS Code por voz só funciona no Windows por enquanto.'), { code: 501 });
  const exe = [path.join(env('LOCALAPPDATA'), 'Programs/Microsoft VS Code/Code.exe'), path.join(env('ProgramFiles'), 'Microsoft VS Code/Code.exe')].find(p => OPEN.exists(p));
  if (!exe) throw Object.assign(new Error('Não encontrei o VS Code instalado.'), { code: 404 });
  return run(exe, [dir, file]);
}
// Pede ao app da Steam a janela de instalação de um jogo (o id vem da loja e é só número; a Steam pede a sua confirmação).
export async function openSteamInstall(uri) {
  if (OPEN.platform !== 'win32') throw Object.assign(new Error('Instalar pela Steam só funciona no Windows por enquanto.'), { code: 501 });
  if (!/^steam:\/\/(install|rungameid)\/\d{1,9}$/.test(uri)) throw Object.assign(new Error('Pedido inválido.'), { code: 400 });
  return run('explorer.exe', [uri]);
}
export async function openTarget(o) {
  if (OPEN.platform !== 'win32') {
    const opener = OPEN.platform === 'darwin' ? 'open' : 'xdg-open';
    if (o.type === 'url') return run(opener, [o.url]);
    throw Object.assign(new Error('Abrir apps por voz só funciona no Windows por enquanto.'), { code: 501 });
  }
  if (o.type === 'url') {
    if (!/^https:\/\/[^\s"]+$/.test(o.url)) throw Object.assign(new Error('Endereço inválido.'), { code: 400 });
    const c = chromePath();
    return c ? run(c, [o.url]) : run('explorer.exe', [o.url]);   // sem Chrome: navegador padrão
  }
  if (o.type === 'custom') return run('explorer.exe', [o.path]);
  if (o.type === 'installed') {
    // Só IDs que vieram da lista do Windows (nunca texto falado); o próprio Windows abre pelo menu Iniciar.
    if (!installed.some(a => a.id === o.key) || !/^[^"\r\n\0]{2,300}$/.test(o.key)) throw Object.assign(new Error('Não encontrei esse app instalado.'), { code: 404 });
    return run('explorer.exe', [`shell:AppsFolder\\${o.key}`]);
  }
  const how = APPS[o.key]?.();
  if (!how) throw Object.assign(new Error('Não conheço esse app.'), { code: 404 });
  return run(how.cmd, how.args);
}
