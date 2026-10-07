// Configuração central. O nome do assistente vive em UMA constante: troque aqui e pronto.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSISTANT_NAME = 'JARVIS';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Hospedado (Vercel etc.): o disco do projeto é somente leitura; só /tmp aceita escrita (e some quando a função "dorme").
export const ON_VERCEL = process.env.VERCEL === '1';
export const DATA_DIR = process.env.JARVIS_DATA_DIR ? path.resolve(process.env.JARVIS_DATA_DIR) : ON_VERCEL ? '/tmp/jarvis-data' : path.join(ROOT, 'data');
export const PORT = Number(process.env.PORT) || 3000;
// Só escuta na própria máquina. Mude HOST por sua conta e risco.
export const DEMO = process.env.JARVIS_DEMO === '1';

// Modo hospedado: endereço público + senha. Sem JARVIS_PUBLIC_URL, usa o domínio de produção que a própria Vercel informa.
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || '';
export const PUBLIC_URL = (process.env.JARVIS_PUBLIC_URL || (ON_VERCEL && vercelHost ? `https://${vercelHost}` : '')).trim().replace(/\/+$/, '');
export const HOSTED = !!PUBLIC_URL || ON_VERCEL;
export const BASE_URL = PUBLIC_URL || `http://localhost:${PORT}`;
export const PASSWORD = process.env.JARVIS_PASSWORD || '';
// Local: só a própria máquina. Hospedado fora da Vercel (Render, Railway...): precisa escutar em todas as interfaces; a senha protege.
export const HOST = process.env.HOST || (PUBLIC_URL ? '0.0.0.0' : '127.0.0.1');
