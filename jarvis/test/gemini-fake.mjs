// Gemini falso para rodar um servidor em outro processo nos testes (node --import ./test/gemini-fake.mjs server.js).
// Responde com o modelo e se a chave do servidor foi usada, sem internet.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const m = String(url).match(/generativelanguage\.googleapis\.com\/v1beta\/models\/([^:]+):generateContent/);
  if (!m) return realFetch(url, opt);
  const body = JSON.parse(opt.body || '{}'), key = opt.headers?.['x-goog-api-key'];
  const last = body.contents?.at(-1)?.parts?.[0]?.text || '';
  const intro = `via servidor ${decodeURIComponent(m[1])} chave ${key === process.env.GEMINI_API_KEY ? 'ok' : 'errada'}: ${last.slice(0, 40)}`;
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intro, slides: [], outro: '' }) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
