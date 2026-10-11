// "Baixar para Windows": monta na hora um .zip com o Jarvis (servidor) e o Jarvis Desktop (app + Jarvis Code).
// Lista do que PODE entrar (allowlist), nunca o contrário: dados pessoais, chaves, .env, logs, amostras de voz e o perfil
// do navegador flutuante (navegador-flutuante/) ficam de fora, e o config.json do app também (ele cria o padrão ao abrir).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { zip } from './images.js';

const MASCOT = () => path.join(ROOT, '..', 'mascote');
const JARVIS_FILES = ['server.js', 'package.json', 'index.html', 'landing.html', 'site.html', 'login.html', 'download.html', 'windows.html', 'site3d.js', 'site-jc.js', 'site.css', 'models.config.json', 'README.md', 'MUDANCAS.md', '.gitignore'];
const JARVIS_DIRS = ['lib', 'test'];
const MASCOT_FILES = ['JarvisDesktop.exe', 'build.cmd', 'README.md', '.gitignore'];
const MASCOT_DIRS = ['src', 'sprites', 'installer'];
const SKIP = /(^|[\\/])(data|data-demo|logs|navegador-flutuante|previa|node_modules|amostras-voz)([\\/]|$)|\.(env|log|tmp)$|^\.env/i;

function walk(dir, rel, out) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of names) {
    const r = rel ? `${rel}/${d.name}` : d.name, full = path.join(dir, d.name);
    if (SKIP.test(r) || d.isSymbolicLink()) continue;
    if (d.isDirectory()) walk(full, r, out);
    else if (d.isFile()) out.push({ rel: r, full });
  }
}

const README = `JARVIS para Windows
===================

1. Instale o Node.js 20.6 ou mais novo: https://nodejs.org (versão LTS).
2. Extraia esta pasta onde quiser (ex.: Documentos\\Jarvis). Mantenha "jarvis" e "mascote" lado a lado.
3. Abra mascote\\JarvisDesktop.exe. Ele sobe o servidor sozinho e abre o Jarvis.
   (Se o Windows avisar "aplicativo desconhecido": Mais informações > Executar assim mesmo.)
4. Na primeira vez, preencha o perfil e salve a chave do Gemini em Integrações (aistudio.google.com > Get API key).

Sem o app, dá para rodar só o servidor: abra um terminal na pasta jarvis, rode "npm start" e acesse http://localhost:3000/app.
Para recompilar o app depois de mudar o código C#: mascote\\build.cmd.
`;
const ENV_EXAMPLE = `# Tudo opcional: as chaves também podem ser salvas pela interface (Integrações).
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
PORT=3000
`;
export function fileList() {
  const out = [], J = ROOT, M = MASCOT();
  for (const f of JARVIS_FILES) if (fs.existsSync(path.join(J, f))) out.push({ rel: `jarvis/${f}`, full: path.join(J, f) });
  for (const d of JARVIS_DIRS) walk(path.join(J, d), `jarvis/${d}`, out);
  for (const f of MASCOT_FILES) if (fs.existsSync(path.join(M, f))) out.push({ rel: `mascote/${f}`, full: path.join(M, f) });
  for (const d of MASCOT_DIRS) walk(path.join(M, d), `mascote/${d}`, out);
  return out.filter(f => !SKIP.test(f.rel));
}

let cache = null;   // { at, buf }: o zip pronto por 10 min
export function buildZip() {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.buf;
  const files = fileList().map(f => ({ name: `Jarvis/${f.rel}`, buf: fs.readFileSync(f.full) }));
  files.unshift({ name: 'Jarvis/LEIA-ME.txt', buf: Buffer.from(README.replace(/\n/g, '\r\n'), 'utf8') });
  files.push({ name: 'Jarvis/jarvis/.env.example', buf: Buffer.from(ENV_EXAMPLE, 'utf8') });
  // Sem config.json: o Jarvis Desktop cria o padrão na primeira vez (já escolhendo Chrome ou Edge conforme o PC).
  cache = { at: Date.now(), buf: zip(files) };
  return cache.buf;
}
export const _clearCache = () => { cache = null; };

// Instalador: [mascote\JarvisSetup.exe][ZIP][8 bytes com onde o ZIP começa]["JARVISZ1"]. O instalador lê o ZIP do próprio arquivo.
// Sem o JarvisSetup.exe compilado (rode mascote\build.cmd), devolve null e o site entrega o ZIP.
export function buildInstaller() {
  let stub;
  try { stub = fs.readFileSync(path.join(MASCOT(), 'JarvisSetup.exe')); } catch { return null; }
  const zipBuf = buildZip(), tail = Buffer.alloc(16);
  tail.writeBigInt64LE(BigInt(stub.length), 0); tail.write('JARVISZ1', 8, 'ascii');
  return Buffer.concat([stub, zipBuf, tail]);
}
