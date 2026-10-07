// Arquivos locais em data/ (ignorada pelo .gitignore). Escrita atômica e permissão restrita (600).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}
export const filePath = name => path.join(DATA_DIR, name);

export function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath(name), 'utf8')); }
  catch { return structuredClone(fallback); }
}

export function writeJSON(name, data) {
  ensureDir();
  const file = filePath(name), tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows ignora chmod; tudo bem */ }
}

export function removeFile(name) {
  try { fs.unlinkSync(filePath(name)); } catch { /* já não existia */ }
}

// Texto simples (usado pelo audit.log): leitura com valor padrão e acréscimo com permissão restrita.
export function readFile(name, fallback = '') {
  try { return fs.readFileSync(filePath(name), 'utf8'); } catch { return fallback; }
}
export function appendFile(name, text) {
  ensureDir();
  fs.appendFileSync(filePath(name), text, { mode: 0o600 });
}
