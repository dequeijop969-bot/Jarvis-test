// Entrada da Vercel: toda requisição (vercel.json) passa por aqui e é entregue ao mesmo servidor do uso local.
import { server } from '../server.js';
export default (req, res) => { server.emit('request', req, res); };
