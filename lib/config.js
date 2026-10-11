// Configuração central. O nome do assistente vive em UMA constante: troque aqui e pronto.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSISTANT_NAME = 'JARVIS';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.JARVIS_DATA_DIR ? path.resolve(process.env.JARVIS_DATA_DIR) : path.join(ROOT, 'data');
export const PORT = Number(process.env.PORT) || 3000;
// Só escuta na própria máquina. Mude HOST por sua conta e risco.
export const HOST = process.env.HOST || '127.0.0.1';
export const DEMO = process.env.JARVIS_DEMO === '1';
