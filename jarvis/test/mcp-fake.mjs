// Servidor MCP falso (stdio), só para os testes: uma ferramenta de leitura e uma que "altera".
import readline from 'node:readline';
const out = m => process.stdout.write(JSON.stringify(m) + '\n');
const TOOLS = [
  { name: 'eco', description: 'Devolve o texto', inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] }, annotations: { readOnlyHint: true } },
  { name: 'apagar', description: 'Apaga algo', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }
];
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.id == null) return;
  if (m.method === 'initialize') return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'falso', version: '1' } } });
  if (m.method === 'tools/list') return out({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
  if (m.method === 'tools/call') {
    const { name, arguments: a } = m.params;
    if (name === 'eco') return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `eco: ${a.texto} ${process.env.SEGREDO_TESTE ? 'com-env' : ''}` }] } });
    return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'apagado' }] } });
  }
  out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nao' } });
});
