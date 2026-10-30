// Vercel: o site do JARVIS (início, Windows, login e download) roda aqui como uma função só.
// Modo site: nada do assistente (conversa, voz, e-mail, arquivos) existe na nuvem, então nenhuma chave de API fica aqui.
// O assistente roda no PC de cada pessoa, pelo app instalado, com as chaves do .env DELA.
process.env.JARVIS_SITE_ONLY = '1';
process.env.JARVIS_NO_LISTEN = '1';
process.env.JARVIS_DATA_DIR ||= '/tmp/jarvis-data';   // o único lugar gravável na Vercel (e temporário)

const { server } = await import('../jarvis/server.js');
export default function handler(req, res) { server.emit('request', req, res); }
