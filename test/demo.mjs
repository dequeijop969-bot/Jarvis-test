// Modo demonstração: roda o JARVIS sem chaves e sem gastar créditos.
// Simula Gemini, Anthropic, ElevenLabs, Gmail (somente leitura) e Open-Meteo. Voz real só com `npm start`.
// DEMO_TTS=fallback simula falha do endpoint com timestamps; DEMO_TTS=off simula voz indisponível.
// DEMO_FAIL=gemini derruba o Gemini (plano B); DEMO_FAIL=weather derruba o clima.
// Os dados da demo ficam em data-demo/ (não mistura com os seus).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.JARVIS_DEMO = '1';
process.env.JARVIS_NO_LISTEN = '1';
process.env.JARVIS_DATA_DIR ||= path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data-demo');
process.env.GEMINI_API_KEY ||= 'demo-gemini-key-0000';
process.env.ANTHROPIC_API_KEY ||= 'demo-anthropic-key-1111';
process.env.ELEVENLABS_API_KEY ||= 'demo-eleven-key-2222';
process.env.ELEVENLABS_VOICE_ID ||= 'demoVoice01';
const { installMocks } = await import('./mocks.mjs');
installMocks();
const { server } = await import('../server.js');
const { PORT, HOST } = await import('../lib/config.js');
server.listen(PORT, HOST, () => console.log(`JARVIS (demo) em http://localhost:${PORT}  ·  TTS=${process.env.DEMO_TTS || 'ok'}  FAIL=${process.env.DEMO_FAIL || 'nenhum'}`));
