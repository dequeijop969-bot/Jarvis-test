// Resposta do Jarvis (intro, slides, gráfico, outro) virando uma mensagem de WhatsApp: só texto, com *negrito* do próprio
// WhatsApp nos títulos e os links que importam (arquivos do Drive, notícias). Limite de 4096 caracteres por mensagem.
const clean = s => String(s || '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').replace(/[ \t]+/g, ' ').trim();

export function toText(out) {
  if (!out || typeof out !== 'object') return '';
  const parts = [];
  if (out.intro) parts.push(clean(out.intro));
  const slides = Array.isArray(out.slides) ? out.slides : [];
  const many = slides.length > 1;
  for (const s of slides.slice(0, 8)) {
    const lines = [];
    if (many && s.title && !String(s.layout || '').startsWith('jornal-intro')) lines.push(`*${clean(s.title)}*`);
    if (s.narration) lines.push(clean(s.narration));
    else if (s.fact) lines.push(clean(s.fact));
    if (Array.isArray(s.drive)) for (const f of s.drive.slice(0, 6)) lines.push(`• ${clean(f.name)}${/^https:\/\//.test(f.link || '') ? `\n  ${f.link}` : ''}`);
    if (Array.isArray(s.tarefas) && !s.narration) for (const t of s.tarefas.slice(0, 10)) lines.push(`☐ ${clean(t.title)}`);
    const link = s.jornal?.url || s.jornal?.link;
    if (/^https:\/\//.test(link || '')) lines.push(link);
    if (lines.length) parts.push(lines.join('\n'));
  }
  if (out.outro) parts.push(clean(out.outro));
  let text = parts.filter(Boolean).join('\n\n');
  if (!text && out.error) text = clean(out.error);
  return text.length > 4000 ? text.slice(0, 3990).replace(/\s+\S*$/, '') + '…' : text;
}
