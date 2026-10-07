// Ações sob pedido: framework servidor para confirmação, risos, expiração, audit.
// Ações são criadas quando a IA sugerem ou o usuário pede (em /api/chat com ferramentas de ação).
// Confirmação: POST /api/actions/:id/confirm (com x-jarvis).
// Interruptores por serviço: gmail_trash, github_write. Desligam sozinhos após 15 min.
// audit.log em data/ (sem tokens, sem e-mail content, sem segredos).

import crypto from 'node:crypto';
import { readJSON, writeJSON, readFile, appendFile } from './store.js';
import { log } from './secrets.js';

const ACTIONS_FILE = 'actions.json';
const AUDIT_FILE = 'audit.log';
const ACTION_TTL = 2 * 60_000;      // 2 minutos
const TOGGLE_TTL = 15 * 60_000;     // 15 minutos (auto-desliga)
const EMPTY_ACTIONS = { pending: {}, toggles: { gmail_trash: false, github_write: false }, toggleExpiry: {} };

let state = null;
const load = () => (state ??= { ...structuredClone(EMPTY_ACTIONS), ...readJSON(ACTIONS_FILE, EMPTY_ACTIONS) });
const save = () => writeJSON(ACTIONS_FILE, state);
const id = () => crypto.randomBytes(6).toString('hex');

// Tipos de ação válidos com schemas de validação.
const ACTIONS_SCHEMA = {
  'gmail_trash': {
    params: (p) => Array.isArray(p.ids) && p.ids.length > 0 && p.ids.length <= 25 && Array.isArray(p.preview),
    risk: (p) => p.ids.length > 10 ? 'alto' : 'normal'
  },
  'gmail_untrash': {
    params: (p) => Array.isArray(p.ids) && p.ids.length > 0 && p.ids.length <= 25,
    risk: () => 'normal'
  },
  'calendar_create': {
    params: (p) => typeof p.title === 'string' && p.title.length > 0 && Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start && typeof p.tz === 'string',
    risk: () => 'normal'
  },
  'github_createbranch': {
    params: (p) => typeof p.repo === 'string' && typeof p.branch === 'string' && typeof p.from === 'string',
    risk: () => 'normal'
  },
  'github_commit': {
    params: (p) => typeof p.repo === 'string' && typeof p.branch === 'string' && Array.isArray(p.files) && p.files.length > 0 && p.files.length <= 3 && typeof p.message === 'string',
    risk: () => 'normal'
  },
  'github_pr': {
    params: (p) => typeof p.repo === 'string' && typeof p.branch === 'string' && typeof p.title === 'string' && typeof p.body === 'string',
    risk: () => 'normal'
  },
  'github_merge': {
    params: (p) => typeof p.repo === 'string' && typeof p.pr === 'number' && typeof p.into === 'string',
    risk: () => 'alto'  // Merge é sempre risco alto
  },
  'github_comment': {
    params: (p) => typeof p.repo === 'string' && (typeof p.pr === 'number' || typeof p.issue === 'number') && typeof p.body === 'string',
    risk: () => 'normal'
  },
  'github_labels': {
    params: (p) => typeof p.repo === 'string' && (typeof p.pr === 'number' || typeof p.issue === 'number') && Array.isArray(p.labels),
    risk: () => 'normal'
  }
};

// Purga ações e toggles expirados.
function purge() {
  const s = load(), now = Date.now();
  for (const aid of Object.keys(s.pending)) {
    if (now - s.pending[aid].at > ACTION_TTL) delete s.pending[aid];
  }
  for (const [svc, exp] of Object.entries(s.toggleExpiry || {})) {
    if (now - exp > TOGGLE_TTL) {
      delete s.toggles[svc];
      delete s.toggleExpiry[svc];
    }
  }
  save();
}

// Cria ação pendente. Devolve {id, kind, params, preview, risk, expiresAt}.
export function createAction(kind, params, preview) {
  if (!(kind in ACTIONS_SCHEMA)) throw new Error(`Tipo de ação desconhecido: ${kind}`);
  const schema = ACTIONS_SCHEMA[kind];
  if (!schema.params(params)) throw new Error(`Parâmetros inválidos para ${kind}`);
  
  purge();
  const s = load(), aid = id(), now = Date.now(), risk = schema.risk(params);
  s.pending[aid] = { kind, params, preview, risk, at: now, confirmed: false };
  save();
  
  return { id: aid, kind, params, preview, risk, expiresAt: new Date(now + ACTION_TTL).toISOString() };
}

// Retorna ação pendente se válida e não confirmada. null se expirada ou confirmada.
export function getAction(aid) {
  purge();
  const s = load();
  if (!s.pending[aid]) return null;
  const a = s.pending[aid];
  if (a.confirmed) return null;  // Já usada
  const now = Date.now();
  if (now - a.at > ACTION_TTL) {
    delete s.pending[aid];
    save();
    return null;
  }
  return { id: aid, kind: a.kind, params: a.params, preview: a.preview, risk: a.risk };
}

// Confirma ação (one-time). Devolve {kind, params, success: true} ou erro.
export async function confirmAction(aid, userContext = '') {
  purge();
  const s = load();
  if (!s.pending[aid]) throw new Error('Ação não encontrada ou expirada.');
  const a = s.pending[aid];
  if (a.confirmed) throw new Error('Ação já foi confirmada.');
  
  // Verifica toggle do serviço se necessário.
  const toggleKey = {
    'gmail_trash': 'gmail_trash',
    'gmail_untrash': 'gmail_trash',
    'github_createbranch': 'github_write',
    'github_commit': 'github_write',
    'github_pr': 'github_write',
    'github_merge': 'github_write',
    'github_comment': 'github_write',
    'github_labels': 'github_write'
  }[a.kind];
  
  if (toggleKey) {
    if (!s.toggles[toggleKey]) throw new Error(`Ações de ${toggleKey} desligadas. Ligue nas integrações.`);
    // Reseta a expiração do toggle.
    s.toggleExpiry[toggleKey] = Date.now();
  }
  
  // Marca como confirmada (não deleta ainda, precisa para auditoria).
  a.confirmed = true;
  save();
  
  // Audit log: apenas info não-sensível.
  auditLog({
    service: a.kind.split('_')[0] || 'unknown',  // 'gmail', 'github' ou 'calendar'
    action: a.kind,
    target: a.params.ids ? `${a.params.ids.length} items` : (a.params.repo || a.params.pr || (a.kind === 'calendar_create' ? 'evento' : 'unknown')),
    result: 'pending_confirmation',
    userSnippet: userContext.slice(0, 80)  // Primeiros 80 chars do pedido
  });
  
  return { id: aid, kind: a.kind, params: a.params, success: true };
}

// Limpa ação após execução bem-sucedida.
export function clearAction(aid) {
  const s = load();
  if (s.pending[aid]) {
    delete s.pending[aid];
    save();
  }
}

// Liga/desliga um toggle de serviço. Desliga sozinho em TOGGLE_TTL.
export function setToggle(service, enabled) {
  const s = load();
  if (enabled) {
    s.toggles[service] = true;
    s.toggleExpiry[service] = Date.now();
  } else {
    delete s.toggles[service];
    delete s.toggleExpiry[service];
  }
  save();
}

// Retorna estado de um toggle.
export function getToggle(service) {
  purge();
  const s = load();
  return !!s.toggles[service];
}

// Todos os toggles vistos pela interface.
export function allToggles() {
  purge();
  const s = load();
  return { gmail_trash: !!s.toggles.gmail_trash, github_write: !!s.toggles.github_write };
}

// Escreve em audit.log (data/, fora do git): {timestamp, service, action, target, result, userSnippet}.
// Nunca inclui tokens, conteúdo de e-mail, ou dados pessoais.
export function auditLog(entry) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry
  });
  try {
    appendFile(AUDIT_FILE, line + '\n');
  } catch (e) {
    log.warn('[audit] falhou:', e.message);
  }
}

// Lê audit.log dos últimos N dias (por padrão, 1 dia).
export function readAuditLog(days = 1) {
  try {
    const content = readFile(AUDIT_FILE, '');
    const cutoff = Date.now() - days * 24 * 3600_000;
    return content.split('\n').filter(l => {
      try {
        const e = JSON.parse(l);
        return Date.parse(e.timestamp) >= cutoff;
      } catch { return false; }
    }).map(l => JSON.parse(l));
  } catch { return []; }
}

// Cleanup para testes.
export const _reset = () => { state = null; };
