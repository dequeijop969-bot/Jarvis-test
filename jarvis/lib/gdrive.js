// Google Drive (mesmo login do Gmail): procurar seus arquivos (somente leitura, drive.readonly) e salvar no Drive o que
// o Jarvis cria (drive.file: só os arquivos que ele mesmo enviou, numa pasta "Jarvis"). Nada é apagado nem alterado.
import fs from 'node:fs';
import path from 'node:path';
import { gfetch, canDrive, canDriveSave, canDriveEdit, canDocs } from './google.js';

const API = 'https://www.googleapis.com/drive/v3';
const FIELDS = 'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName),size,shortcutDetails)';
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const KIND = m => /folder/.test(m) ? 'pasta' : /document/.test(m) ? 'documento' : /spreadsheet|excel|csv/.test(m) ? 'planilha' : /presentation|powerpoint/.test(m) ? 'apresentação'
  : /pdf/.test(m) ? 'PDF' : /image/.test(m) ? 'imagem' : /video/.test(m) ? 'vídeo' : /audio/.test(m) ? 'áudio' : /zip|compressed/.test(m) ? 'zip' : 'arquivo';
const pack = f => ({ id: f.id, name: f.name, kind: KIND(f.mimeType || ''), mime: f.mimeType, modified: f.modifiedTime, link: f.webViewLink || '', owner: f.owners?.[0]?.displayName || '', size: Number(f.size) || null });

export async function search(q, max = 8) {
  if (!canDrive()) throw Object.assign(new Error('Falta a permissão do Drive. Reconecte o Google em Ajustes marcando todas as caixas.'), { code: 403 });
  const words = String(q).trim().split(/\s+/).filter(w => w.length >= 2).slice(0, 6);
  const name = words.map(w => `name contains '${esc(w)}'`).join(' and ');
  const query = `trashed = false and ((${name || `name contains '${esc(q)}'`}) or fullText contains '${esc(q)}')`;
  const u = `${API}/files?${new URLSearchParams({ q: query, fields: FIELDS, orderBy: 'modifiedTime desc', pageSize: String(max), supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`;
  return ((await gfetch(u))?.files || []).map(pack);
}
export async function recent(max = 8) {
  if (!canDrive()) throw Object.assign(new Error('Falta a permissão do Drive. Reconecte o Google em Ajustes.'), { code: 403 });
  const u = `${API}/files?${new URLSearchParams({ q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'", fields: FIELDS, orderBy: 'viewedByMeTime desc', pageSize: String(max) })}`;
  return ((await gfetch(u))?.files || []).map(pack);
}
// Pasta "Jarvis" no Drive (criada pelo próprio Jarvis; com drive.file ele só enxerga o que criou).
async function jarvisFolder() {
  const found = await gfetch(`${API}/files?${new URLSearchParams({ q: "name = 'Jarvis' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields: 'files(id,webViewLink)', pageSize: '1' })}`);
  if (found?.files?.[0]) return found.files[0];
  return gfetch(`${API}/files?fields=id,webViewLink`, { method: 'POST', body: { name: 'Jarvis', mimeType: 'application/vnd.google-apps.folder' } });
}
const MIME = { pdf: 'application/pdf', html: 'text/html', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
// Envia um arquivo do PC para a pasta Jarvis do Drive (até 25 MB).
export async function upload(file, name) {
  if (!canDriveSave()) throw Object.assign(new Error('Falta a permissão de salvar no Drive. Reconecte o Google em Ajustes marcando todas as caixas.'), { code: 403 });
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > 25 * 1024 * 1024) throw Object.assign(new Error('Esse arquivo é grande demais para enviar (máx. 25 MB).'), { code: 413 });
  const folder = await jarvisFolder(), fname = name || path.basename(file), ext = path.extname(fname).slice(1).toLowerCase();
  const boundary = 'jarvis' + Date.now().toString(36);
  const meta = JSON.stringify({ name: fname, parents: [folder.id] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${MIME[ext] || 'application/octet-stream'}\r\n\r\n`),
    fs.readFileSync(file), Buffer.from(`\r\n--${boundary}--`)]);
  const f = await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,modifiedTime', { method: 'POST', body, raw: true, headers: { 'content-type': `multipart/related; boundary=${boundary}` } });
  return { ...pack(f), folderLink: folder.webViewLink || '' };
}

/* ---------- Alterar (precisa da permissão "drive" completa; texto de Documento, da "documents") ---------- */
const needEdit = () => { if (!canDriveEdit()) throw Object.assign(new Error('Para eu alterar o seu Drive, reconecte o Google em Ajustes marcando a permissão de ver, editar e excluir arquivos do Drive.'), { code: 403 }); };
const FOLDER = 'application/vnd.google-apps.folder', GDOC = 'application/vnd.google-apps.document';
// O arquivo (ou pasta) que mais combina com o nome dito: nome igual primeiro, depois o mais recente da busca.
export async function find(name, { folder = false } = {}) {
  const q = String(name || '').trim(); if (!q) return null;
  const list = (await search(q, 10)).filter(f => (folder ? f.mime === FOLDER : true));
  const n = q.toLowerCase();
  return list.find(f => f.name.toLowerCase() === n) || list.find(f => f.name.toLowerCase().startsWith(n)) || list[0] || null;
}
export async function rename(file, newName) {
  needEdit();
  return pack(await gfetch(`${API}/files/${encodeURIComponent(file.id)}?fields=${encodeURIComponent('id,name,mimeType,modifiedTime,webViewLink')}&supportsAllDrives=true`, { method: 'PATCH', body: { name: String(newName).slice(0, 200) } }));
}
export async function move(file, folder) {
  needEdit();
  const cur = await gfetch(`${API}/files/${encodeURIComponent(file.id)}?fields=parents&supportsAllDrives=true`);
  const u = `${API}/files/${encodeURIComponent(file.id)}?${new URLSearchParams({ addParents: folder.id, removeParents: (cur?.parents || []).join(','), fields: 'id,name,mimeType,modifiedTime,webViewLink', supportsAllDrives: 'true' })}`;
  return pack(await gfetch(u, { method: 'PATCH', body: {} }));
}
export async function createFolder(name, parent = null) {
  needEdit();
  return pack(await gfetch(`${API}/files?fields=id,name,mimeType,modifiedTime,webViewLink`, { method: 'POST', body: { name: String(name).slice(0, 200), mimeType: FOLDER, ...(parent ? { parents: [parent.id] } : {}) } }));
}
// Documento Google com o texto (o Drive converte texto simples em Documento; não precisa da API do Docs).
export async function createDoc(name, text, parent = null) {
  if (!canDriveSave()) throw Object.assign(new Error('Reconecte o Google em Ajustes marcando a permissão do Drive.'), { code: 403 });
  const boundary = 'jarvis' + Date.now().toString(36);
  const meta = JSON.stringify({ name: String(name).slice(0, 200), mimeType: GDOC, ...(parent ? { parents: [parent.id] } : {}) });
  const body = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${String(text || '')}\r\n--${boundary}--`, 'utf8');
  return pack(await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink', { method: 'POST', body, raw: true, headers: { 'content-type': `multipart/related; boundary=${boundary}` } }));
}
const needDocs = f => {
  if (f.mime !== GDOC) throw Object.assign(new Error(`"${f.name}" não é um Documento Google; só consigo editar o texto de Documentos.`), { code: 400 });
  if (!canDocs()) throw Object.assign(new Error('Para eu editar o texto de Documentos, reconecte o Google em Ajustes marcando a permissão do Google Docs.'), { code: 403 });
};
export async function appendText(file, text) {
  needDocs(file);
  const doc = await gfetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(file.id)}?fields=body(content(endIndex))`);
  const end = Math.max(1, (doc?.body?.content || []).reduce((m, c) => Math.max(m, c.endIndex || 1), 1) - 1);
  await gfetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(file.id)}:batchUpdate`, { method: 'POST', body: { requests: [{ insertText: { location: { index: end }, text: '\n' + String(text) } }] } });
  return file;
}
export async function replaceText(file, from, to) {
  needDocs(file);
  const r = await gfetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(file.id)}:batchUpdate`, { method: 'POST', body: { requests: [{ replaceAllText: { containsText: { text: String(from), matchCase: false }, replaceText: String(to) } }] } });
  return r?.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
}
export async function trash(id) {
  needEdit();
  return pack(await gfetch(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,webViewLink&supportsAllDrives=true`, { method: 'PATCH', body: { trashed: true } }));
}

// Entende o pedido: { op:'buscar', q } | { op:'recentes' } | { op:'salvar' } | { op:'abrir', n } | null
const foldT = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
export function parse(text) {
  const t = foldT(text).replace(/^(jarvis|ei|por favor) /, '');
  if (!/\bdrive\b/.test(t) && !/^abre o (primeiro|segundo|terceiro|quarto|quinto)( arquivo)?$/.test(t)) return null;
  if (/\b(salva|salvar|sobe|subir|manda|mandar|envia|enviar|guarda|guardar|coloca|bota)\b.*\b(no|pro|para o|pra o|ao) (meu )?drive\b/.test(t) && !/\b(pasta|documento|doc)\b/.test(t)) return { op: 'salvar' };
  if (/\b(renomei\w*|renomear|muda(r)? o nome|troca(r)? o nome|move|mover|mova|passa(r)? (o|a|os|as) .* pra pasta|cria|criar|crie|faz uma pasta|nova pasta|apaga\w*|exclui\w*|deleta\w*|lixeira|remove\w*|escreve\w*|adiciona\w*|acrescenta\w*|inclui\w*|edita\w*|altera\w*|substitui\w*|troca|corrige|atualiza\w*)\b/.test(t)) return { op: 'editar', text: String(text).slice(0, 600) };
  const ab = t.match(/^abre o (primeiro|segundo|terceiro|quarto|quinto)( arquivo)?( do drive)?$/);
  if (ab) return { op: 'abrir', n: ['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto'].indexOf(ab[1]) };
  if (/\b(recentes?|ultimos arquivos|o que tem no (meu )?drive|meus arquivos do drive)\b/.test(t)) return { op: 'recentes' };
  const m = t.match(/\b(?:acha|ache|achar|procura|procure|procurar|busca|busque|buscar|encontra|encontre|localiza|cade|onde (?:esta|ta))\b\s+(?:no (?:meu )?drive\s+)?(?:o |a |os |as |um |uma |meu |minha )?(.+?)(?:\s+no (?:meu )?(?:google )?drive)?$/);
  if (m && m[1] && !/^(no )?(meu )?drive$/.test(m[1])) {
    const q = m[1].replace(/\b(arquivo|documento|pdf|planilha) (do|da|de)\b/, '').replace(/^(arquivo|documento) /, '').trim();
    const orig = String(text).replace(/[^\p{L}\p{N}\s.-]/gu, ' ').split(/\s+/).filter(Boolean), want = q.split(' ');
    for (let i = 0; i + want.length <= orig.length; i++) if (want.every((w, k) => foldT(orig[i + k]) === w)) return { op: 'buscar', q: orig.slice(i, i + want.length).join(' ') };
    return { op: 'buscar', q };
  }
  return { op: 'recentes' };
}
