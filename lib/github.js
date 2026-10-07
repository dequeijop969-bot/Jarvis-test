// GitHub com dois tokens de ESCOPO FINO (fine-grained), separados:
//   github_read  -> Metadata, Contents, Pull requests, Issues, Actions, Checks e Commit statuses em LEITURA
//   github_write -> Contents, Pull requests e Issues em leitura e escrita; Metadata em leitura (nada além disso)
// Toda chamada passa por assertGithubAllowed: lista fechada de endpoints. Force push, apagar repositório ou branch,
// configurações, colaboradores, segredos, webhooks, .github/workflows e commit na branch padrão NÃO existem aqui.
// Títulos, corpos, comentários e mensagens de commit são DADOS de terceiros, nunca instruções.
import fs from 'node:fs';
import path from 'node:path';
import { getKey } from './keys.js';
import { readJSON, writeJSON } from './store.js';
import { log, looksSecret } from './secrets.js';
import { ROOT } from './config.js';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28'; // versão estável suportada até 10/03/2028 (a 2026-03-10 tem mudanças que não revisei)
export const LIMITS = { files: 3, lines: 200, prs: 6, repos: 6 };
const SETTINGS = 'github.local.json';

/* ---------- Configuração: repositórios escolhidos ---------- */
const REPO_RE = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
export const getSettings = () => ({ repos: [], ...readJSON(SETTINGS, {}) });
export function setRepos(input) {
  const list = (Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/)).map(s => String(s).trim()).filter(Boolean);
  const bad = list.filter(r => !REPO_RE.test(r));
  if (bad.length) throw Object.assign(new Error(`Formato inválido: use dono/repositorio (${bad[0].slice(0, 40)}).`), { code: 400 });
  const repos = [...new Set(list)].slice(0, 20);
  writeJSON(SETTINGS, { ...getSettings(), repos });
  clearCache();
  return repos;
}
export const allowedRepo = r => getSettings().repos.some(x => x.toLowerCase() === String(r || '').toLowerCase());

/* ---------- Lista fechada de endpoints ---------- */
const R = '/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+';
const N = '\\d{1,9}';
const READ = [/^\/user$/, /^\/user\/repos\?/, /^\/search\/issues\?/, new RegExp(`^${R}(\\?.*)?$`), new RegExp(`^${R}/(pulls|issues|commits|actions/runs|contents|git/ref|branches|readme|actions/secrets|hooks|pages)(/|\\?|$)`)];
const WRITE = [
  ['POST', new RegExp(`^${R}/issues$`)], ['POST', new RegExp(`^${R}/issues/${N}/comments$`)],
  ['POST', new RegExp(`^${R}/issues/${N}/labels$`)], ['DELETE', new RegExp(`^${R}/issues/${N}/labels/[^/]+$`)],
  ['PATCH', new RegExp(`^${R}/issues/${N}$`)], ['PATCH', new RegExp(`^${R}/pulls/${N}$`)],
  ['POST', new RegExp(`^${R}/pulls/${N}/requested_reviewers$`)], ['POST', new RegExp(`^${R}/actions/runs/${N}/rerun-failed-jobs$`)],
  ['POST', new RegExp(`^${R}/git/refs$`)], ['PUT', new RegExp(`^${R}/contents/.+$`)],
  ['POST', new RegExp(`^${R}/pulls$`)], ['PUT', new RegExp(`^${R}/pulls/${N}/merge$`)]
];
const NEVER = /\/(hooks|collaborators|keys|actions\/secrets|environments|pages|branches\/[^/]+\/protection|actions\/permissions|invitations|transfer|dispatches)\b|\/git\/refs\/|\.github\/workflows/i;
export const isWorkflowPath = p => /^\.github\/workflows(\/|$)/i.test(String(p || '').replace(/^\/+/, ''));
export function assertGithubAllowed(method, p, body) {
  const m = String(method || 'GET').toUpperCase(), s = String(p || ''), pathOnly = s.split('?')[0];
  const deny = msg => { throw Object.assign(new Error(msg || 'Operação do GitHub não permitida pelo JARVIS.'), { code: 403, forbidden: true }); };
  if (m === 'GET') { if (!READ.some(re => re.test(s))) deny(); return; }
  if (body && typeof body === 'object' && 'force' in body) deny('Force push é proibido.');
  if (body?.__probe === true && Object.keys(body).length !== 1) deny();
  if (NEVER.test(decodeURIComponent(pathOnly))) deny();
  if (!WRITE.some(([mm, re]) => mm === m && re.test(pathOnly))) deny();
  if (m === 'POST' && /\/git\/refs$/.test(pathOnly) && body?.__probe !== true && !/^refs\/heads\/jarvis\/[a-z0-9._-]{1,60}$/.test(body?.ref || '')) deny('Só crio branches jarvis/...');
  if (m === 'PUT' && /\/contents\//.test(pathOnly) && !/^jarvis\/[a-z0-9._-]{1,60}$/.test(body?.branch || '')) deny('Commit só em branch jarvis/..., nunca na padrão.');
}

/* ---------- HTTP com cache curto e respeito ao rate limit ---------- */
const cache = new Map();
export const clearCache = () => cache.clear();
let blockedUntil = 0, lastRate = null;
export const rateInfo = () => lastRate;

export async function gh(kind, method, p, body) {
  assertGithubAllowed(method, p, body);
  const token = kind === 'write' ? getKey('github_write') : (getKey('github_read') || getKey('github_write'));
  if (!token) throw Object.assign(new Error(kind === 'write' ? 'Falta o token de escrita do GitHub.' : 'GitHub não conectado.'), { code: 409 });
  if (Date.now() < blockedUntil) throw Object.assign(new Error('Limite de uso do GitHub atingido. Tento de novo em instantes.'), { code: 429 });
  const ck = method === 'GET' ? `${kind}|${p}` : null;
  if (ck) { const hit = cache.get(ck); if (hit && hit.exp > Date.now()) return hit.v; }
  const send = { ...(body || {}) }; delete send.__probe;
  let r;
  try {
    r = await fetch(API + p, {
      method, signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': API_VERSION, 'user-agent': 'jarvis-local', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(send) : undefined
    });
  } catch { throw Object.assign(new Error('Sem conexão com o GitHub.'), { code: 502, status: 0 }); }
  const rem = Number(r.headers.get('x-ratelimit-remaining')), reset = Number(r.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(rem)) lastRate = { remaining: rem, reset: reset * 1000 };
  if (r.status === 429 || (r.status === 403 && rem === 0)) {
    const ra = Number(r.headers.get('retry-after'));
    blockedUntil = ra ? Date.now() + ra * 1000 : reset ? reset * 1000 : Date.now() + 60_000;
    throw Object.assign(new Error('Limite de uso do GitHub atingido. Tento de novo em instantes.'), { code: 429, status: r.status });
  }
  if (Number.isFinite(rem) && rem <= 2 && reset) blockedUntil = reset * 1000;
  const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) {
    const need = r.headers.get('x-accepted-github-permissions') || '';
    const msg = r.status === 401 ? 'Token do GitHub inválido ou expirado.' : r.status === 404 ? 'Não encontrei isso no GitHub (ou o token não tem acesso).'
      : r.status === 403 ? `O GitHub recusou: falta permissão${need ? ` (${need.slice(0, 80)})` : ''}.` : r.status === 405 ? 'O GitHub não permitiu (proteção de branch ou PR não mesclável).'
      : r.status === 409 ? 'Conflito no GitHub: o arquivo ou a branch mudou. Peça de novo.' : r.status === 422 ? 'O GitHub recusou os dados enviados.' : `O GitHub respondeu com erro ${r.status}.`;
    throw Object.assign(new Error(msg), { code: r.status === 401 ? 409 : 502, status: r.status, need });
  }
  if (ck) { cache.set(ck, { v: j, exp: Date.now() + 60_000 }); if (cache.size > 300) cache.delete(cache.keys().next().value); }
  return j;
}
const enc = s => String(s).split('/').map(encodeURIComponent).join('/');
const clip = (s, n) => String(s || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const repoOf = url => (String(url || '').match(/\/repos\/([^/]+\/[^/]+)$/) || [])[1] || '';

/* ---------- Testar token: login + permissões efetivas (sondagem segura) ---------- */
// Não há API para listar as permissões de um token de escopo fino. Então sondamos:
// leitura = GET simples; escrita = POST com corpo vazio, que o GitHub recusa com 422 (validação) se a permissão
// existe e 403 se não existe; nada é criado. "Workflows" é só escrita e não dá para sondar sem escrever: confira na página do token.
async function status(kind, method, p, body) {
  try { await gh(kind, method, p, body); return 200; }
  catch (e) { if (e.forbidden) throw e; return e.status ?? 0; }
}
export async function testToken(kind) {
  let user;
  try { user = await gh(kind, 'GET', '/user'); }
  catch (e) { return { ok: false, message: e.status === 401 ? 'Token inválido ou expirado.' : e.message }; }
  let repos = [];
  try { repos = await gh(kind, 'GET', '/user/repos?per_page=100&sort=pushed'); } catch { /* segue */ }
  const chosen = getSettings().repos;
  const sample = [...repos.filter(r => chosen.includes(r.full_name)), ...repos.filter(r => !chosen.includes(r.full_name))].slice(0, 2);
  const perms = { metadata: 'none', contents: 'none', pull_requests: 'none', issues: 'none', actions: 'none', checks: 'none', statuses: 'none' };
  const extra = new Set();
  const up = (k, v) => { const o = { none: 0, read: 1, write: 2 }; if (o[v] > o[perms[k]]) perms[k] = v; };
  for (const r of sample) {
    const base = `/repos/${enc(r.full_name)}`, def = r.default_branch || 'main';
    if (await status(kind, 'GET', base) === 200) up('metadata', 'read');
    let sha = null;
    try { const c = await gh(kind, 'GET', `${base}/commits?per_page=1`); sha = c?.[0]?.sha; up('contents', 'read'); } catch { }
    if (await status(kind, 'GET', `${base}/pulls?per_page=1`) === 200) up('pull_requests', 'read');
    if (await status(kind, 'GET', `${base}/issues?per_page=1`) === 200) up('issues', 'read');
    if (await status(kind, 'GET', `${base}/actions/runs?per_page=1`) === 200) up('actions', 'read');
    if (sha && await status(kind, 'GET', `${base}/commits/${sha}/check-runs?per_page=1`) === 200) up('checks', 'read');
    if (sha && await status(kind, 'GET', `${base}/commits/${sha}/status`) === 200) up('statuses', 'read');
    if (await status(kind, 'POST', `${base}/issues`, {}) === 422) up('issues', 'write');
    if (await status(kind, 'POST', `${base}/pulls`, {}) === 422) up('pull_requests', 'write');
    if (await status(kind, 'POST', `${base}/git/refs`, { __probe: true }) === 422) up('contents', 'write');
    if (await status(kind, 'GET', `${base}/actions/secrets?per_page=1`) === 200) extra.add('Secrets');
    if (await status(kind, 'GET', `${base}/hooks?per_page=1`) === 200) extra.add('Webhooks');
    if (await status(kind, 'GET', `${base}/pages`) === 200) extra.add('Pages');
    // Proteção de branch: 200 ou 404 ("não protegida") só aparecem para quem tem Administration.
    if ([200, 404].includes(await status(kind, 'GET', `${base}/branches/${encodeURIComponent(def)}/protection`))) extra.add('Administration');
  }
  const warnings = [];
  const writes = Object.entries(perms).filter(([, v]) => v === 'write').map(([k]) => k);
  if (kind === 'read' && writes.length) warnings.push(`O token de leitura tem ESCRITA em ${writes.join(', ')}. Gere um só com leitura.`);
  if (kind === 'write') for (const k of ['contents', 'pull_requests', 'issues']) if (perms[k] !== 'write') warnings.push(`Falta escrita em ${k}.`);
  if (extra.size) warnings.push(`Permissões além do necessário: ${[...extra].join(', ')}. Remova no GitHub.`);
  if (!sample.length) warnings.push('O token não enxerga nenhum repositório.');
  const login = clip(user.login, 39);
  return {
    ok: true, login, repos: repos.length, perms, extra: [...extra], warnings,
    message: `Funcionando: @${login}, ${repos.length} ${repos.length === 1 ? 'repositório' : 'repositórios'}.${warnings.length ? ' Atenção: ' + warnings.join(' ') : ''} Workflows não dá para sondar: confira na página do token.`
  };
}

/* ---------- Leitura ---------- */
export async function myRepos() {
  const list = await gh('read', 'GET', '/user/repos?per_page=100&sort=pushed');
  const chosen = getSettings().repos.map(r => r.toLowerCase());
  const mine = (Array.isArray(list) ? list : []).filter(r => !chosen.length || chosen.includes(String(r.full_name).toLowerCase()));
  return mine.map(r => ({ repo: r.full_name, default_branch: r.default_branch || 'main', url: r.html_url, private: !!r.private, pushed_at: r.pushed_at, language: r.language || '' }));
}
const inScope = repo => { const c = getSettings().repos.map(r => r.toLowerCase()); return !c.length || c.includes(repo.toLowerCase()); };
async function searchIssues(q) {
  const j = await gh('read', 'GET', `/search/issues?${new URLSearchParams({ q, per_page: '20', sort: 'updated' })}`);
  return (j.items || []).map(i => ({ repo: repoOf(i.repository_url), number: i.number, title: clip(i.title, 140), url: i.html_url, author: clip(i.user?.login, 39), updated_at: i.updated_at, draft: !!i.draft, labels: (i.labels || []).map(l => clip(l.name, 30)).slice(0, 4) }))
    .filter(i => i.repo && inScope(i.repo));
}
export async function ciState(repo, sha) {
  const base = `/repos/${enc(repo)}`;
  let runs = [], st = null;
  try { runs = (await gh('read', 'GET', `${base}/commits/${sha}/check-runs?per_page=50`)).check_runs || []; } catch { }
  try { st = await gh('read', 'GET', `${base}/commits/${sha}/status`); } catch { }
  const bad = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);
  const statuses = st?.statuses || [];
  if (runs.some(r => bad.has(r.conclusion)) || statuses.some(s => ['failure', 'error'].includes(s.state))) return 'failure';
  if (runs.some(r => r.status !== 'completed') || statuses.some(s => s.state === 'pending')) return 'pending';
  if (runs.length || statuses.length) return 'success';
  return 'none';
}
export async function prInfo(repo, number) {
  const base = `/repos/${enc(repo)}`;
  const p = await gh('read', 'GET', `${base}/pulls/${number}`);
  let reviews = [];
  try { reviews = await gh('read', 'GET', `${base}/pulls/${number}/reviews?per_page=50`); } catch { }
  const last = new Map(); for (const r of reviews || []) if (r.user?.login) last.set(r.user.login, r.state);
  return {
    repo, number, title: clip(p.title, 140), url: p.html_url, base: p.base?.ref, head: p.head?.ref, sha: p.head?.sha, draft: !!p.draft,
    state: p.merged ? 'merged' : p.state, mergeable_state: p.mergeable_state || 'unknown',
    reviews: { approved: [...last.values()].filter(s => s === 'APPROVED').length, changes: [...last.values()].filter(s => s === 'CHANGES_REQUESTED').length },
    ci: p.head?.sha ? await ciState(repo, p.head.sha) : 'none'
  };
}
// Devolve as falhas e também quantos repositórios foram realmente verificados (sem isso, "nada falhou" não prova nada).
export async function ciCheck(repos) {
  const failures = []; let checked = 0, withRuns = 0;
  const list = repos.slice(0, LIMITS.repos);
  await Promise.all(list.map(async r => {
    try {
      const j = await gh('read', 'GET', `/repos/${enc(r.repo)}/actions/runs?${new URLSearchParams({ branch: r.default_branch, per_page: '20', exclude_pull_requests: 'true' })}`);
      checked++;
      const latest = new Map();
      for (const run of j.workflow_runs || []) if (!latest.has(run.workflow_id)) latest.set(run.workflow_id, run);
      if (latest.size) withRuns++;
      for (const run of latest.values()) if (run.status === 'completed' && ['failure', 'timed_out', 'startup_failure'].includes(run.conclusion))
        failures.push({ repo: r.repo, run_id: run.id, name: clip(run.name, 60), branch: r.default_branch, url: run.html_url, at: run.created_at });
    } catch { /* sem permissão de Actions nesse repositório: não conta como verificado */ }
  }));
  return { failures, checked, withRuns, total: list.length };
}
export const ciFailures = async repos => (await ciCheck(repos)).failures;
export async function summary() {
  const failed = [];
  const soft = (label, fallback) => e => { failed.push({ label, why: e?.status === 401 || e?.code === 409 ? 'token' : e?.code === 429 ? 'limite' : e?.status === 403 ? 'permissão' : 'erro', message: e?.message || '' }); return fallback; };
  const [review, mineRaw, issues, repos] = await Promise.all([
    searchIssues('is:pr is:open archived:false review-requested:@me').catch(soft('revisões pedidas', [])),
    searchIssues('is:pr is:open archived:false author:@me').catch(soft('seus pull requests', [])),
    searchIssues('is:issue is:open archived:false assignee:@me').catch(soft('issues', [])),
    myRepos().catch(soft('repositórios', []))
  ]);
  // Token ausente ou inválido: não adianta fingir que está tudo bem.
  if (failed.length === 4 && failed.every(f => f.why === 'token')) throw Object.assign(new Error(failed[0].message || 'Não consegui entrar no GitHub. Confira o token em Integrações.'), { code: 409 });
  const mine = await Promise.all(mineRaw.slice(0, LIMITS.prs).map(p => prInfo(p.repo, p.number).catch(() => ({ ...p, ci: 'unknown', reviews: { approved: 0, changes: 0 } }))));
  const cc = await ciCheck(repos);
  return { review, mine, issues, ci: cc.failures, ciChecked: cc.checked, ciWithRuns: cc.withRuns, ciTotal: cc.total, failed: failed.map(f => f.label), repos: repos.slice(0, 12), repoCount: repos.length, at: new Date().toISOString() };
}
export async function recentCommits(repo, n = 5) {
  const j = await gh('read', 'GET', `/repos/${enc(repo)}/commits?per_page=${n}`);
  return (Array.isArray(j) ? j : []).map(c => ({ sha: String(c.sha).slice(0, 7), message: clip(String(c.commit?.message || '').split('\n')[0], 100), author: clip(c.commit?.author?.name || c.author?.login, 40), date: c.commit?.author?.date, url: c.html_url }));
}
// "repositório X" falado -> nome real (só entre os que o token enxerga).
export async function resolveRepo(spoken) {
  const want = String(spoken || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9/._ -]/g, '').trim().replace(/\s+/g, '-');
  if (!want) return null;
  const repos = await myRepos();
  return repos.find(r => r.repo.toLowerCase() === want) || repos.find(r => r.repo.split('/')[1].toLowerCase() === want)
    || repos.find(r => r.repo.toLowerCase().includes(want)) || repos.find(r => r.repo.split('/')[1].toLowerCase().replace(/[-_.]/g, '') === want.replace(/[-_.]/g, '')) || null;
}

/* ---------- Fala (modelos fixos) ---------- */
const n = (k, s, p) => `${k === 1 ? 'um' : k} ${k === 1 ? s : p}`;
const short = r => String(r).split('/')[1] || r;
const spokenName = r => short(r).replace(/[-_.]+/g, ' ');
const joinList = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} e ${a.at(-1)}`;
export function ago(iso, t = Date.now()) {
  const d = Math.floor((t - Date.parse(iso)) / 86400_000);
  if (!Number.isFinite(d)) return 'sem data';
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : d < 30 ? `há ${d} dias` : d < 365 ? `há ${Math.floor(d / 30)} ${Math.floor(d / 30) === 1 ? 'mês' : 'meses'}` : 'há mais de um ano';
}
// Falamos "testes automáticos" em vez de "CI": a sigla sai mal pronunciada na voz.
export function summarySpeech(s, focus = 'all') {
  const bits = [], failedLabels = s.failed || [];
  const miss = l => failedLabels.includes(l);
  if (failedLabels.length) bits.push(`Atenção: não consegui consultar ${joinList(failedLabels)}, então o que falo abaixo pode estar incompleto.`);
  if ((focus === 'all' || focus === 'review') && !miss('revisões pedidas'))
    bits.push(s.review.length ? `${n(s.review.length, 'pull request aguarda', 'pull requests aguardam')} sua revisão${s.review.length <= 2 ? `: ${s.review.map(p => `${spokenName(p.repo)}, número ${p.number}`).join(' e ')}` : ''}.` : 'Nenhum pull request aguardando sua revisão.');
  if (focus === 'all' || focus === 'ci') {
    const bad = [...new Set([...s.ci.map(c => spokenName(c.repo)), ...s.mine.filter(p => p.ci === 'failure').map(p => `${spokenName(p.repo)}, número ${p.number}`)])];
    if (bad.length) bits.push(`Os testes automáticos estão falhando em ${bad.slice(0, 3).join(', ')}.`);
    else if (!s.ciChecked) bits.push('Não consegui verificar os testes automáticos: o token talvez não tenha permissão de Actions.');
    else if (!s.ciWithRuns) bits.push('Não encontrei testes automáticos rodando nos seus repositórios.');
    else bits.push(`Os testes automáticos estão passando nos ${s.ciWithRuns === 1 ? 'único repositório' : s.ciWithRuns + ' repositórios'} que têm Actions${s.ciChecked < s.ciTotal ? `, mas só consegui verificar ${s.ciChecked} de ${s.ciTotal}` : ''}.`);
  }
  if (focus === 'all') {
    if (s.mine.length) bits.push(`${s.mine.length === 1 ? 'Você tem um pull request aberto' : `Você tem ${s.mine.length} pull requests abertos`}${s.mine.some(p => p.reviews?.approved) ? `, ${s.mine.filter(p => p.reviews?.approved).length} com aprovação` : ''}.`);
    if (s.issues.length) bits.push(`E ${n(s.issues.length, 'issue atribuída', 'issues atribuídas')} a você.`);
  }
  return bits.join(' ');
}

/* ---------- Repositórios: listar e olhar um por dentro ---------- */
export function reposSpeech(repos, addr = { Subject: 'O senhor' }) {
  if (!repos.length) return `Não encontrei repositórios que esse token consiga ver. Confira o token e os repositórios escolhidos em Integrações.`;
  const top = repos.slice(0, 5).map(r => `${spokenName(r.repo)}, mexido ${ago(r.pushed_at)}`);
  return `${addr.Subject} tem ${n(repos.length, 'repositório', 'repositórios')} liberados${repos.length >= 100 ? ' (olhei os 100 mais recentes)' : ''}. Os mais recentes: ${joinList(top)}. Peça, por exemplo, "fala do repositório" e o nome, que eu abro um por dentro.`;
}
const decodeB64 = b => Buffer.from(String(b || ''), 'base64').toString('utf8');
export async function repoOverview(repo) {
  const base0 = `/repos/${enc(repo)}`;
  const info = await gh('read', 'GET', base0);
  const [commits, readme] = await Promise.all([
    recentCommits(repo, 5).catch(() => null),
    gh('read', 'GET', `${base0}/readme`).then(j => clip(decodeB64(j.content).replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#>*`_|]/g, ' '), 1500)).catch(() => '')
  ]);
  return { repo, description: clip(info.description, 200), language: clip(info.language, 30), private: !!info.private, archived: !!info.archived, default_branch: info.default_branch || 'main', pushed_at: info.pushed_at, open_issues: Number(info.open_issues_count) || 0, commits, readme };
}
export function overviewSpeech(o, aiSummary = '') {
  const bits = [`${spokenName(o.repo)}${o.language ? `, em ${o.language}` : ''}${o.private ? ', privado' : ''}${o.archived ? ', arquivado' : ''}.`];
  bits.push(aiSummary || (o.description ? `${o.description.replace(/\.$/, '')}.` : 'Sem descrição cadastrada.'));
  bits.push(`Última atividade ${ago(o.pushed_at)}.`);
  if (o.commits === null) bits.push('Não consegui ler os últimos commits.');
  else if (o.commits.length) bits.push(`Último commit: ${o.commits[0].message.replace(/\.$/, '')}, de ${o.commits[0].author || 'alguém'}.`);
  if (o.open_issues) bits.push(`${n(o.open_issues, 'item aberto', 'itens abertos')} entre issues e pull requests.`);
  return bits.join(' ');
}
export function commitsSpeech(repo, commits) {
  if (!commits.length) return `Não encontrei commits em ${spokenName(repo)}.`;
  return `Últimos commits de ${spokenName(repo)}: ${joinList(commits.slice(0, 4).map(c => `${c.message.replace(/\.$/, '')}, ${ago(c.date)}`))}.`;
}
export const memoryLines = s => [...s.review.map(p => `revisar ${p.repo}#${p.number} ${p.title}`), ...s.mine.map(p => `meu PR ${p.repo}#${p.number} ${p.title} (testes ${p.ci})`), ...s.ci.map(c => `testes automáticos falharam em ${c.repo}: ${c.name}`)];

/* ---------- Escrita (só chamada por actions.js, depois da confirmação) ---------- */
const FOOTER = '\n\n---\n_Criado pelo assistente JARVIS a pedido do dono do repositório._';
const base = repo => `/repos/${enc(repo)}`;
export const createIssue = (repo, { title, body }) => gh('write', 'POST', `${base(repo)}/issues`, { title, body: (body || '') + FOOTER });
export const comment = (repo, num, body) => gh('write', 'POST', `${base(repo)}/issues/${num}/comments`, { body: body + '\n\n_(via JARVIS)_' });
export const addLabels = (repo, num, labels) => gh('write', 'POST', `${base(repo)}/issues/${num}/labels`, { labels });
export const removeLabel = (repo, num, label) => gh('write', 'DELETE', `${base(repo)}/issues/${num}/labels/${encodeURIComponent(label)}`);
export const setIssueState = (repo, num, state) => gh('write', 'PATCH', `${base(repo)}/issues/${num}`, { state });
export const updatePR = (repo, num, patch) => gh('write', 'PATCH', `${base(repo)}/pulls/${num}`, patch);
export const requestReviewers = (repo, num, reviewers) => gh('write', 'POST', `${base(repo)}/pulls/${num}/requested_reviewers`, { reviewers });
export const rerunFailed = (repo, runId) => gh('write', 'POST', `${base(repo)}/actions/runs/${runId}/rerun-failed-jobs`);
export const mergePR = (repo, num, sha, method = 'merge') => gh('write', 'PUT', `${base(repo)}/pulls/${num}/merge`, { sha, merge_method: method });

// Lê os arquivos (máx. 3) na branch padrão para montar o plano.
export async function readFiles(repo, paths) {
  const info = await gh('write', 'GET', base(repo));
  const def = info.default_branch || 'main';
  const files = [];
  for (const p of paths) {
    try {
      const j = await gh('write', 'GET', `${base(repo)}/contents/${enc(p)}?ref=${encodeURIComponent(def)}`);
      if (Array.isArray(j) || j.type !== 'file') throw Object.assign(new Error(`${p} não é um arquivo.`), { code: 400 });
      if ((j.size || 0) > 200_000) throw Object.assign(new Error(`${p} é grande demais para eu editar com segurança.`), { code: 400 });
      files.push({ path: p, sha: j.sha, content: Buffer.from(j.content || '', 'base64').toString('utf8'), exists: true });
    } catch (e) { if (e.status === 404) files.push({ path: p, sha: null, content: '', exists: false }); else throw e; }
  }
  const ref = await gh('write', 'GET', `${base(repo)}/git/ref/heads/${encodeURIComponent(def)}`);
  return { default_branch: def, base_sha: ref.object?.sha, files, secretsInSource: files.reduce((a, f) => a + looksSecret(f.content), 0) };
}

export const slug = s => String(s || 'ajuste').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ajuste';

// Branch nova jarvis/..., um commit por arquivo NA BRANCH NOVA, PR para a padrão. Nunca toca a padrão.
export async function applyChange(plan) {
  const { repo, default_branch: def, base_sha, files, title, body } = plan;
  let branch = `jarvis/${slug(plan.branch)}`;
  if (branch === `jarvis/${def}` || !branch.startsWith('jarvis/')) throw Object.assign(new Error('Branch inválida.'), { code: 400 });
  for (let i = 0; i < 4; i++) {
    try { await gh('write', 'POST', `${base(repo)}/git/refs`, { ref: `refs/heads/${branch}`, sha: base_sha }); break; }
    catch (e) { if (e.status === 422 && i < 3) { branch = `jarvis/${slug(plan.branch)}-${Date.now().toString(36).slice(-4)}`; continue; } throw e; }
  }
  for (const f of files) {
    if (isWorkflowPath(f.path)) throw Object.assign(new Error('Não mexo em .github/workflows.'), { code: 403 });
    await gh('write', 'PUT', `${base(repo)}/contents/${enc(f.path)}`, {
      message: `${title}\n\nAlteração proposta pelo assistente JARVIS.`, content: Buffer.from(f.next, 'utf8').toString('base64'), branch, ...(f.sha ? { sha: f.sha } : {})
    });
  }
  const pr = await gh('write', 'POST', `${base(repo)}/pulls`, { title, head: branch, base: def, body: `${body || ''}\n\n---\n_Pull request criado pelo assistente JARVIS a pedido do dono do repositório. Revise antes de mesclar._`, draft: false });
  let ci = 'pending'; try { ci = await ciState(repo, (await gh('write', 'GET', `${base(repo)}/pulls/${pr.number}`)).head?.sha); } catch { }
  return { branch, number: pr.number, url: pr.html_url, ci };
}

/* ---------- Diff legível (linhas) ---------- */
export function lineDiff(a, b, ctx = 3) {
  const A = String(a).split('\n'), B = String(b).split('\n');
  if (A.length * B.length > 9_000_000) throw Object.assign(new Error('Arquivo grande demais para comparar.'), { code: 400 });
  const n = A.length, m = B.length, W = m + 1, L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { ops.push([' ', A[i], i, j]); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { ops.push(['-', A[i], i, j]); i++; } else { ops.push(['+', B[j], i, j]); j++; } }
  while (i < n) { ops.push(['-', A[i], i, j]); i++; } while (j < m) { ops.push(['+', B[j], i, j]); j++; }
  const changed = ops.filter(o => o[0] !== ' ').length;
  const hunks = []; let k = 0;
  while (k < ops.length) {
    if (ops[k][0] === ' ') { k++; continue; }
    const s = Math.max(0, k - ctx); let e = k;
    while (e < ops.length) { if (ops[e][0] !== ' ') { e++; continue; } let run = 0; while (e + run < ops.length && ops[e + run][0] === ' ') run++; if (run > ctx * 2 || e + run >= ops.length) { e = Math.min(ops.length, e + ctx); break; } e += run; }
    const lines = ops.slice(s, e);
    hunks.push({ a: (lines[0][2] ?? 0) + 1, b: (lines[0][3] ?? 0) + 1, lines: lines.map(o => [o[0], o[1]]) });
    k = e;
  }
  return { changed, added: ops.filter(o => o[0] === '+').length, removed: ops.filter(o => o[0] === '-').length, hunks };
}
export function unifiedPatch(files) {
  return files.map(f => {
    const d = f.diff;
    return `--- ${f.exists ? 'a/' + f.path : '/dev/null'}\n+++ b/${f.path}\n` + d.hunks.map(h => {
      const na = h.lines.filter(l => l[0] !== '+').length, nb = h.lines.filter(l => l[0] !== '-').length;
      return `@@ -${h.a},${na} +${h.b},${nb} @@\n` + h.lines.map(([t, s]) => t + s).join('\n');
    }).join('\n');
  }).join('\n') + '\n';
}
// Quando algo é proibido (workflows, branch padrão), oferecemos um .patch local em proposals/.
export function writeProposal(name, patch) {
  const dir = path.join(ROOT, 'proposals');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug(name)}-${new Date().toISOString().slice(0, 10)}.patch`);
  fs.writeFileSync(file, patch, { mode: 0o600 });
  log.info(`[github] proposta salva em proposals/${path.basename(file)}`);
  return `proposals/${path.basename(file)}`;
}
