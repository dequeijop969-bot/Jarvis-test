// Gera o valor de JARVIS_OWNER_PASSWORD_HASH (a senha do site na Vercel nunca fica em texto puro).
// Uso: node jarvis/tools/senha-site.mjs "sua senha forte"
const { hashForSite } = await import('../lib/users.js');
const pw = process.argv[2];
if (!pw || pw.length < 10) { console.error('Use uma senha com pelo menos 10 caracteres: node jarvis/tools/senha-site.mjs "sua senha"'); process.exit(1); }
console.log(`JARVIS_OWNER_PASSWORD_HASH=${await hashForSite(pw)}`);
