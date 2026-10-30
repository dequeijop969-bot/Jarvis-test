// Pasta de projeto: o Jarvis cria e edita arquivos numa pasta que VOCÊ escolheu (ex.: C:\Projetos\padaria),
// não só em Documentos\Jarvis Code. Regras:
//   - a pasta só muda pela interface (janela do Windows ou caminho colado), nunca por voz nem pela IA;
//   - pastas de sistema e a do próprio Jarvis ficam de fora (raiz do disco, Windows, Arquivos de Programas, AppData...);
//   - só arquivos de código/texto, dentro da pasta (sem "..", sem atalhos que levem para fora), fora de pastas ocultas e de dependências;
//   - criar nunca sobrescreve; editar guarda a versão anterior em data/versoes/ antes de gravar.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readJSON, writeJSON } from './store.js';
import { ROOT, DATA_DIR } from './config.js';
import { LANG } from './codewriter.js';

const FILE = 'workspace.json';
export const WS = { platform: process.platform, pick: null };   // trocáveis nos testes
const EXTRA = { h: 'C', hpp: 'C++', scss: 'SCSS', less: 'LESS', toml: 'TOML', ini: 'INI', csv: 'CSV' };
export const langOf = f => LANG[path.extname(f).slice(1).toLowerCase()] || EXTRA[path.extname(f).slice(1).toLowerCase()] || null;
const IGNORE = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'bin', 'obj', 'vendor', 'coverage', 'venv', '__pycache__', 'packages']);
export const MAX_EDIT = 120_000;   // bytes: acima disso, editar de uma vez não é seguro
const err = (code, message) => Object.assign(new Error(message), { code });
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

let st = null;
const load = () => (st ??= { active: null, recent: [], ...readJSON(FILE, {}) });
const save = () => writeJSON(FILE, st);

const under = (p, dir) => { if (!dir) return false; const r = path.relative(path.resolve(dir), path.resolve(p)); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };
const real = p => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

// Por que essa pasta não pode ser usada (ou null se pode).
export function blocked(p) {
  const r = real(p), env = k => process.env[k] || '';
  if (path.parse(r).root.toLowerCase() === (r.endsWith(path.sep) ? r : r + path.sep).toLowerCase()) return 'na raiz do disco';
  const home = env('USERPROFILE') || env('HOME');
  if (home && path.resolve(r).toLowerCase() === path.resolve(home).toLowerCase()) return 'na sua pasta de usuário inteira (escolha uma pasta de projeto dentro dela)';
  for (const [dir, why] of [[env('WINDIR') || env('SystemRoot'), 'numa pasta do Windows'], [env('ProgramFiles'), 'em Arquivos de Programas'], [env('ProgramFiles(x86)'), 'em Arquivos de Programas'],
    [env('ProgramData'), 'numa pasta de sistema'], [env('APPDATA'), 'na pasta AppData'], [env('LOCALAPPDATA'), 'na pasta AppData'], [path.join(ROOT, '..'), 'na pasta do próprio Jarvis'], [DATA_DIR, 'na pasta de dados do Jarvis']])
    if (dir && under(r, dir)) return why;
  return null;
}

export function setActive(p) {
  const dir = String(p || '').trim().replace(/^"|"$/g, '');
  if (!dir || !path.isAbsolute(dir)) throw err(400, 'Use o caminho completo da pasta (ex.: C:\\Projetos\\padaria).');
  let s; try { s = fs.statSync(dir); } catch { throw err(400, 'Não encontrei essa pasta. Confira o caminho.'); }
  if (!s.isDirectory()) throw err(400, 'Isso é um arquivo, não uma pasta.');
  const why = blocked(dir);
  if (why) throw err(400, `Por segurança, não trabalho ${why}.`);
  const full = real(dir), c = load();
  c.active = full; c.recent = [full, ...c.recent.filter(x => x.toLowerCase() !== full.toLowerCase())].slice(0, 6);
  save(); return status();
}
export function clear() { load().active = null; save(); return status(); }
export const active = () => { const a = load().active; try { return a && fs.statSync(a).isDirectory() && !blocked(a) ? a : null; } catch { return null; } };

// Arquivos do projeto (caminhos relativos, mais recentes primeiro), sem dependências, pastas ocultas nem binários.
export function listTree(max = 80) {
  const root = active(); if (!root) return [];
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 5 || out.length > 2000) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of ents) {
      if (d.name.startsWith('.') || d.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { const sub = path.join(dir, d.name); if (!IGNORE.has(d.name.toLowerCase()) && !under(sub, path.join(ROOT, '..')) && !under(sub, DATA_DIR)) walk(sub, r, depth + 1); }
      else if (d.isFile() && langOf(d.name)) { try { const s = fs.statSync(path.join(dir, d.name)); out.push({ rel: r, at: s.mtimeMs, size: s.size }); } catch { /* sumiu */ } }
    }
  };
  walk(root, '', 0);
  return out.sort((a, b) => b.at - a.at).slice(0, max);
}

export function status() {
  const a = active(), c = load();
  return { active: a ? { path: a, name: path.basename(a), files: listTree(2000).length } : null, recent: c.recent.filter(x => x !== a).slice(0, 5) };
}

// Caminho relativo seguro dentro da pasta ativa (ou erro). Aceita "src/App.jsx" e "src\\App.jsx".
export function resolveRel(rel, { mustExist = false } = {}) {
  const root = active();
  if (!root) throw err(409, 'Nenhuma pasta de projeto escolhida.');
  const parts = String(rel || '').replace(/\\/g, '/').split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) throw err(400, 'Caminho de arquivo inválido.');
  for (const s of parts) {
    if (s === '..' || s === '.' || s.startsWith('.') || !/^[\w\-. ()@+]{1,80}$/u.test(s) || /[. ]$/.test(s)) throw err(400, `Nome não permitido: ${s.slice(0, 40)}`);
    if (IGNORE.has(s.toLowerCase())) throw err(400, `Não mexo dentro de ${s}.`);
  }
  const name = parts.at(-1);
  if (!langOf(name)) throw err(400, 'Só arquivos de código ou texto (nada de .exe, .bat, .ps1...).');
  const full = path.join(root, ...parts);
  if (!under(full, root)) throw err(400, 'Fora da pasta do projeto.');
  // Pasta-mãe que contém o próprio Jarvis (ex.: Downloads): o código e os dados dele continuam intocáveis.
  if (under(real(full), path.join(ROOT, '..')) || under(full, path.join(ROOT, '..')) || under(full, DATA_DIR)) throw err(400, 'Não mexo nos arquivos do próprio Jarvis.');
  // Pastas que já existem no caminho não podem ser atalhos para fora do projeto.
  let p = path.dirname(full);
  while (!fs.existsSync(p) && under(p, root)) p = path.dirname(p);
  if (!under(real(p), real(root))) throw err(400, 'Fora da pasta do projeto.');
  if (mustExist) {
    let s; try { s = fs.lstatSync(full); } catch { throw err(404, `Não encontrei ${parts.join('/')} no projeto.`); }
    if (!s.isFile() || s.isSymbolicLink()) throw err(400, 'Isso não é um arquivo comum.');
  }
  return { full, rel: parts.join('/') };
}

// Qual arquivo do projeto o pedido cita: caminho exato, nome do arquivo, ou palavras do pedido no caminho; empate = o mais recente.
export function findFile(hint, text) {
  const files = listTree(400);
  if (!files.length) return null;
  const h = String(hint || '').replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
  const exact = h && (files.find(f => f.rel.toLowerCase() === h) || files.find(f => path.posix.basename(f.rel).toLowerCase() === path.posix.basename(h)));
  if (exact) return exact.rel;
  const words = new Set(fold(`${hint} ${text}`).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !['arquivo', 'codigo', 'projeto', 'pasta', 'refina', 'melhora', 'muda', 'edita', 'jarvis', 'que', 'para', 'pra', 'com'].includes(w)));
  let best = null, score = 0;
  for (const f of files) {
    const have = new Set(fold(f.rel).replace(/[^a-z0-9]+/g, ' ').split(' '));
    const s = [...words].filter(w => have.has(w)).length;
    if (s > score) { best = f; score = s; }
  }
  if (best) return best.rel;
  return /\b(ultimo|ultima|[dn]?esse|[dn]?essa|[dn]?este|[dn]?esta|isso|dele|dela|nele|nela|anterior)\b/.test(fold(text)) ? files[0].rel : null;
}

// Cria um arquivo NOVO (com as pastas do caminho). Nunca sobrescreve.
export function createFile(rel, content) {
  const { full, rel: r } = resolveRel(rel);
  if (fs.existsSync(full)) throw err(409, `${r} já existe no projeto. Peça para editar em vez de criar.`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, { encoding: 'utf8', flag: 'wx' });
  return { full, rel: r };
}

export function readExisting(rel) {
  const { full, rel: r } = resolveRel(rel, { mustExist: true });
  if (fs.statSync(full).size > MAX_EDIT) throw err(413, `${r} é grande demais para eu reescrever de uma vez.`);
  return { full, rel: r, current: fs.readFileSync(full, 'utf8') };
}

// Versão anterior em data/versoes/<projeto>/<caminho com __>.<data>.<ext>, fora do projeto (não suja o git).
export function backup(full) {
  const root = active(), rel = path.relative(root, full).split(path.sep).join('__'), ext = path.extname(rel);
  const dir = path.join(DATA_DIR, 'versoes', path.basename(root).replace(/[^\w.-]+/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, `${rel.slice(0, rel.length - ext.length)}.${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}${ext}`);
  fs.copyFileSync(full, to);
  return to;
}

// Janela "Escolher pasta" do Windows (aberta pelo servidor, que roda no seu PC). Devolve o caminho ou null se cancelar.
WS.pick = () => new Promise((ok, fail) => {
  if (WS.platform !== 'win32') return fail(err(501, 'A janela de escolher pasta só existe no Windows. Cole o caminho no campo.'));
  const ps = "Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    "$d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Escolha a pasta do projeto para o Jarvis criar e editar arquivos'; $d.ShowNewFolderButton=$true; " +
    "$f=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false;WindowState='Minimized'}; " +
    "if($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK){$d.SelectedPath}";
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps], { windowsHide: true, timeout: 5 * 60_000 }, (e, out) => {
    if (e) return fail(err(502, 'Não consegui abrir a janela de escolher pasta.'));
    ok(String(out).trim() || null);
  });
});
export const _reset = () => { st = null; };
