// Lê e valida models.config.json. Um nível sem modelo fica marcado e a interface avisa.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ASSISTANT_NAME } from './config.js';

export const LEVEL_IDS = ['1.0', '2.5', '5.1'];
const PROVIDERS = new Set(['gemini', 'anthropic']);
const REASONING = { gemini: new Set(['minimal', 'low', 'medium', 'high']), anthropic: new Set(['low', 'medium', 'high']) };
const PLACEHOLDER = /^(|a definir|tbd|todo)$/i;

function checkTarget(t, where, warnings) {
  if (!t || typeof t !== 'object') return null;
  const provider = t.provider, model = typeof t.model === 'string' ? t.model.trim() : '';
  if (!PROVIDERS.has(provider) || PLACEHOLDER.test(model)) return null;
  if (!/^[\w.\-:@/]{2,80}$/.test(model)) { warnings.push(`${where}: ID de modelo com formato estranho.`); return null; }
  let reasoning = t.reasoning ?? null;
  if (reasoning && !REASONING[provider].has(reasoning)) { warnings.push(`${where}: raciocínio "${reasoning}" ignorado.`); reasoning = null; }
  if (provider === 'gemini' && reasoning === 'minimal' && /gemini-3\.[78]-flash/.test(model)) {
    warnings.push(`${where}: ${model} não aceita "minimal"; usando "low".`); reasoning = 'low';
  }
  return { provider, model, reasoning };
}

export function loadModels(file = path.join(ROOT, 'models.config.json')) {
  const warnings = [];
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { warnings.push('models.config.json ausente ou inválido.'); }
  const levels = {};
  for (const id of LEVEL_IDS) {
    const l = raw.levels?.[id] || {};
    const primary = checkTarget(l, `Nível ${id}`, warnings);
    const fallback = (Array.isArray(l.fallback) ? l.fallback : []).map((f, i) => checkTarget(f, `Nível ${id}, plano B ${i + 1}`, warnings)).filter(Boolean);
    levels[id] = {
      id, name: `${ASSISTANT_NAME} ${id}`, label: typeof l.label === 'string' ? l.label : '',
      ok: !!primary, primary, fallback
    };
    if (!primary) warnings.push(`O nível ${ASSISTANT_NAME} ${id} está sem modelo definido.`);
  }
  const reserve = checkTarget(raw.reserve, 'Reserva', warnings);
  let def = LEVEL_IDS.includes(raw.default_level) ? raw.default_level : '2.5';
  if (!levels[def].ok) def = LEVEL_IDS.find(i => levels[i].ok) || def;
  return { levels, reserve, defaultLevel: def, warnings };
}

// Versão segura para a interface (sem nada sensível; IDs de modelo não são segredo).
export const publicLevels = m => LEVEL_IDS.map(id => {
  const l = m.levels[id];
  return { id, name: l.name, label: l.label, ok: l.ok, provider: l.primary?.provider || null, model: l.primary?.model || null };
});
