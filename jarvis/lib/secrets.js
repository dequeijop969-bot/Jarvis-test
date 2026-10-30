// Registro de segredos em uso, para apagá-los de qualquer texto antes de logar ou responder.
const known = new Set();
export function registerSecret(v) { if (typeof v === 'string' && v.length >= 8) known.add(v); }
export function forgetSecret(v) { known.delete(v); }

// Padrões comuns de chave/token (IA, Google, GitHub, AWS, Slack, chaves privadas).
const PATTERNS = [
  /\bsk-ant-[\w-]{8,}/g, /\bAIza[\w-]{20,}/g, /\bya29\.[\w.-]{10,}/g, /\b1\/\/[\w.-]{20,}/g, /\bsk_[\w]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bAKIA[0-9A-Z]{16}\b/g, /\bxox[abprs]-[\w-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g
];
// "senha = 'abc...'", "api_key: \"...\"" etc. (usado só para AVISAR; nunca repetimos o valor).
const ASSIGN = /\b(api[_-]?key|secret|token|senha|password|passwd|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/gi;

export function redact(text) {
  let s = String(text ?? '');
  for (const k of known) if (k && s.includes(k)) s = s.split(k).join('[oculto]');
  for (const re of PATTERNS) s = s.replace(re, '[oculto]');
  return s;
}
// Quantos trechos parecem segredo (sem devolver o valor).
export function looksSecret(text) {
  const s = String(text ?? '');
  let n = 0;
  for (const re of [...PATTERNS, ASSIGN]) n += (s.match(new RegExp(re.source, re.flags)) || []).length;
  return n;
}
export function mask(v) {
  if (typeof v !== 'string' || !v) return null;
  return v.length >= 8 ? `••••${v.slice(-4)}` : '••••';
}
export const log = {
  info: (...a) => console.log(...a.map(redact)),
  warn: (...a) => console.warn(...a.map(redact)),
  error: (...a) => console.error(...a.map(redact))
};
