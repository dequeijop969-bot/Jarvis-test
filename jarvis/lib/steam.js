// Modo Code: "instala o Hollow Knight na Steam" (jogo que você já tem).
// Acha o jogo na loja da Steam (busca pública, sem conta) e pede ao app da Steam para instalar (steam://install/<id>).
// A própria Steam mostra a janela de instalação, e é você quem confirma. Nada de login nem senha: a Steam já fica logada no seu PC.
export const STEAM = { fetch: (...a) => fetch(...a) };   // trocável nos testes

export async function findGame(name) {
  const q = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (q.length < 2) return null;
  const r = await STEAM.fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=brazilian&cc=BR`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw Object.assign(new Error('A loja da Steam não respondeu.'), { code: 502 });
  const j = await r.json().catch(() => ({}));
  const it = (j.items || []).find(i => Number.isInteger(i?.id) && i.id > 0 && i.type === 'app') || (j.items || []).find(i => Number.isInteger(i?.id) && i.id > 0);
  return it ? { id: it.id, name: String(it.name || q).slice(0, 120) } : null;
}

export const installUri = id => {
  if (!/^\d{1,9}$/.test(String(id))) throw Object.assign(new Error('Jogo inválido.'), { code: 400 });
  return `steam://install/${id}`;
};
// "inicia o Geometry Dash na Steam": a Steam abre o jogo (se não estiver instalado, ela mesma oferece instalar).
export const runUri = id => {
  if (!/^\d{1,9}$/.test(String(id))) throw Object.assign(new Error('Jogo inválido.'), { code: 400 });
  return `steam://rungameid/${id}`;
};
