// Canva Connect (OAuth 2.0 + PKCE). Estrutura pronta: só conecta; nenhuma função usa o Canva ainda.
// Requisitos (confira em canva.dev): integração criada no Developer Portal (MFA ligado), client ID/secret,
// redirect http://127.0.0.1:PORTA/auth/canva/callback (o Canva não aceita "localhost"). Integração privada exige Canva Enterprise.
import { startFlow, finishFlow, getTokens, setTokens } from './oauth.js';
import { PORT } from './config.js';

const cfg = () => ({ id: process.env.CANVA_CLIENT_ID || '', secret: process.env.CANVA_CLIENT_SECRET || '', redirect: process.env.CANVA_REDIRECT_URI || `http://127.0.0.1:${PORT}/auth/canva/callback` });
const SCOPES = 'profile:read';
export const canvaConfigured = () => !!(cfg().id && cfg().secret);
export function canvaStatus() {
  if (!canvaConfigured()) return { state: 'soon', configured: false, message: 'Em breve. Estrutura pronta: configure CANVA_CLIENT_ID e CANVA_CLIENT_SECRET no .env para testar.' };
  return getTokens('canva') ? { state: 'on', configured: true, message: 'Conectado.' } : { state: 'off', configured: true, message: 'Não conectado.' };
}
export function canvaAuthRedirect() {
  const c = cfg(), { state, challenge } = startFlow('canva');
  const u = new URL('https://www.canva.com/api/oauth/authorize');
  u.search = new URLSearchParams({ code_challenge: challenge, code_challenge_method: 's256', scope: SCOPES, response_type: 'code', client_id: c.id, state, redirect_uri: c.redirect });
  return u.toString();
}
const basic = () => 'Basic ' + Buffer.from(`${cfg().id}:${cfg().secret}`).toString('base64');
export async function canvaCallback(q) {
  const verifier = finishFlow('canva', q.get('state'));
  if (!verifier || q.get('error')) throw new Error('Login no Canva cancelado ou expirado.');
  const r = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST', headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ grant_type: 'authorization_code', code_verifier: verifier, code: q.get('code') || '', redirect_uri: cfg().redirect })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('O Canva recusou o login.');
  setTokens('canva', { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, scope: j.scope });
}
export async function canvaDisconnect() {
  const t = getTokens('canva');
  setTokens('canva', null);
  if (t?.refresh_token) {
    try { await fetch('https://api.canva.com/rest/v1/oauth/revoke', { method: 'POST', headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token }), signal: AbortSignal.timeout(8000) }); } catch { /* tokens locais já apagados */ }
  }
}
