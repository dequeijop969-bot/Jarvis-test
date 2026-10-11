// Jarvis Code em pessoa no site (apresentação e página do app para Windows): os quadros reais do app, animados.
// Atores empoleirados nas telas (.perch[data-script]) e o palco com os modos (#jcStage). Sem os quadros, some sem quebrar a página.
(function () {
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* ===== Jarvis Code em pessoa: os mesmos quadros do Jarvis Desktop (/jc/), animados aqui =====
   Cada "ator" troca de animação (andar, pular, pensar, notebook), anda pela borda da tela, pula e fala num balão.
   Um relógio só (requestAnimationFrame) avança os quadros; os roteiros são funções async que só rodam com o ator visível. */
const ANIMS = { walk: { n: 8, fps: 10 }, jump: { n: 8, fps: 14 }, think: { n: 8, fps: 6 }, notebook: { n: 48, fps: 12 } };
const FR = {};
for (const [k, a] of Object.entries(ANIMS)) FR[k] = Array.from({ length: a.n }, (_, i) => { const im = new Image(); im.src = `/jc/${k}_${String(i + 1).padStart(2, '0')}.png`; return im; });
const actors = [];
// Sem os quadros (servidor antigo, sem a pasta do app): os atores somem sem quebrar a página.
FR.walk[0].addEventListener('error', () => actors.forEach(a => { a.broken = true; a.el.style.display = 'none'; }));
// Cada ator desenha num <canvas> a partir das imagens já carregadas: trocar o src de um <img> a cada quadro geraria milhares de requisições.
function actor(el, scale) {
  const img = el.querySelector('img'), bubble = el.querySelector('.say'), cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  cv.className = 'jcimg'; cv.setAttribute('aria-hidden', 'true'); img.replaceWith(cv);
  const a = { el, cv, bubble, scale, anim: 'walk', f: 0, acc: 0, x: .3, face: 1, lift: 0, visible: false, broken: false,
    set(anim) { if (this.anim !== anim) { this.anim = anim; this.f = 0; this.acc = 0; } this.draw(); },
    draw() {
      const im = FR[this.anim][this.f];
      if (!im.complete || !im.naturalWidth) { im.addEventListener('load', () => { if (FR[this.anim][this.f] === im) this.draw(); }, { once: true }); return; }
      if (cv.width !== im.naturalWidth || cv.height !== im.naturalHeight) { cv.width = im.naturalWidth; cv.height = im.naturalHeight; }
      ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0);
      cv.style.width = im.naturalWidth * this.scale + 'px'; cv.style.height = im.naturalHeight * this.scale + 'px';
    },
    place() { el.style.left = (this.x * 100) + '%'; el.style.setProperty('--lift', this.lift + 'px'); cv.style.transform = `scaleX(${this.face})`; },
    say(text, ms = 1800) { if (!bubble) return; bubble.textContent = text; bubble.classList.add('on'); clearTimeout(this.st); this.st = setTimeout(() => bubble.classList.remove('on'), ms); }
  };
  new IntersectionObserver(es => { a.visible = es[0].isIntersecting; }, { rootMargin: '80px' }).observe(el.closest('.shot, .floor') || el);
  a.draw(); a.place(); actors.push(a); return a;
}
let lastT = performance.now();
function tick(now) {
  const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
  for (const a of actors) {
    if (!a.visible || RM) continue;
    const { n, fps } = ANIMS[a.anim];
    a.acc += dt;
    if (a.acc >= 1 / fps) { a.acc %= 1 / fps; a.f = a.anim === 'jump' ? Math.min(n - 1, a.f + 1) : (a.f + 1) % n; a.draw(); }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const wait = ms => new Promise(r => setTimeout(r, ms));
const whenVisible = async a => { while (!a.visible) await wait(300); };
async function walkTo(a, x, speed = .16, alive = () => true) {
  a.set('walk'); a.face = x >= a.x ? 1 : -1; a.place();
  let t = performance.now();
  while (Math.abs(a.x - x) > .002 && alive()) {
    const now = await nextFrame(), dt = Math.min(.1, (now - t) / 1000); t = now;
    a.x += Math.sign(x - a.x) * Math.min(speed * dt, Math.abs(x - a.x)); a.place();
  }
}
async function jump(a, h = 34, dur = 620, onTop, alive = () => true) {
  a.set('jump'); a.f = 0; a.draw();
  const t0 = performance.now(); let fired = false;
  for (;;) {
    const p = Math.min(1, (performance.now() - t0) / dur);
    a.lift = -Math.sin(Math.PI * p) * h; a.place();
    if (!fired && p >= .5) { fired = true; onTop?.(); }
    if (p >= 1 || !alive()) break;
    await nextFrame();
  }
  a.lift = 0; a.place();
}
async function hold(a, anim, ms, text) { a.set(anim); if (text) a.say(text, ms - 200); await wait(ms); }

// Roteiros de cada tela (repetem para sempre, só quando aparecem na tela).
const SCRIPTS = {
  async discord(a) {
    await walkTo(a, .2); await whenVisible(a);
    await walkTo(a, .6);
    await hold(a, 'think', 2000, 'Ctrl+K e "Sei lá"…');
    await jump(a);
    a.say('Entrei na call. 🔊', 1700); await hold(a, 'think', 1700);
    await walkTo(a, .3);
  },
  async steam(a) {
    const shot = a.el.closest('.shot'), play = shot.querySelector('.play'), launch = shot.querySelector('.launch');
    await walkTo(a, .3); await whenVisible(a);
    await walkTo(a, .55);
    await hold(a, 'think', 1600, 'Biblioteca… achei.');
    await jump(a, 34, 620, () => play.classList.add('press'));
    play.classList.remove('press'); launch.classList.add('on');
    await jump(a, 26, 520); a.say('Bom jogo, senhor!', 1800); await hold(a, 'think', 1800);
    launch.classList.remove('on');
    await walkTo(a, .78);
  },
  async vscode(a) {
    const pre = a.el.closest('.shot').querySelector('pre'), lines = [...pre.querySelectorAll('.l')];
    await walkTo(a, .4); await whenVisible(a);
    await walkTo(a, .74);
    a.set('notebook'); a.say('digitando padaria.html…', 3800);
    pre.classList.add('typing'); lines.forEach(l => l.classList.add('hid'));
    for (const l of lines) { await wait(380); l.classList.remove('hid'); }
    await wait(500); pre.classList.remove('typing');
    await hold(a, 'think', 1700, 'Revisei duas vezes.');
    await walkTo(a, .35);
  },
  // Janela transparente: ele mora em cima dela, de prontidão, enquanto você joga ou programa.
  async float(a) {
    await walkTo(a, .25); await whenVisible(a);
    await walkTo(a, .72);
    await hold(a, 'notebook', 3200, 'De prontidão, senhor.');
    await hold(a, 'think', 1900, 'Aperte Tab e fale.');
    await jump(a, 30, 600);
    await walkTo(a, .4);
  },
  // Pasta de projeto: lê a árvore, cria um arquivo novo e edita outro (com backup).
  async project(a) {
    const shot = a.el.closest('.shot'), add = shot.querySelector('[data-new]'), edit = shot.querySelector('[data-edit]');
    add?.classList.remove('show'); edit?.classList.remove('flash');
    await walkTo(a, .3); await whenVisible(a);
    await walkTo(a, .66);
    await hold(a, 'think', 1700, 'Lendo o projeto…');
    a.set('notebook'); a.say('Criando components/Menu.jsx', 2400);
    await wait(1200); add?.classList.add('show'); await wait(1300);
    a.say('Editando index.html (backup guardado)', 2400); edit?.classList.add('flash');
    await wait(2500);
    await jump(a, 30, 600); a.say('Pronto. Abri no VS Code.', 1700); await hold(a, 'think', 1700);
    await walkTo(a, .35);
  }
};
document.querySelectorAll('.perch').forEach(el => {
  const a = actor(el, 2), run = SCRIPTS[el.dataset.script];
  a.x = el.dataset.script === 'steam' ? .78 : .3; a.place();
  if (RM) { a.set(['vscode', 'float', 'project'].includes(el.dataset.script) ? 'notebook' : 'think'); a.x = .7; a.place(); el.closest('.shot')?.querySelector('[data-new]')?.classList.add('show'); return; }
  if (!run) return;
  (async () => { await wait(400); for (;;) { if (a.broken) return; await whenVisible(a); await run(a); } })();
});

// Palco: o Jarvis Code grande trocando de modo sozinho (ou no que você tocar).
(() => {
  const floor = document.querySelector('#jcStage .floor'), btns = [...document.querySelectorAll('#jcStage .modes button')];
  if (!floor) return;   // página sem o palco
  const a = actor(document.getElementById('stageActor'), 5), shadow = document.getElementById('stageShadow');
  a.el.setAttribute('aria-hidden', 'true'); a.x = .5; a.place();
  const LINES = { walk: 'A caminho do Discord.', jump: 'Hop! Em cima da janela.', think: 'Hmm… o canal fica embaixo.', notebook: 'tec tec tec… pronto.' };
  const DUR = 4600;
  let mode = 'walk', token = 0, userUntil = 0;
  const syncShadow = () => { shadow.style.setProperty('--sx', (a.x * 100) + '%'); shadow.style.setProperty('--ss', String(1 + a.lift / 140)); };
  const origPlace = a.place.bind(a); a.place = () => { origPlace(); syncShadow(); };
  function select(m, byUser) {
    mode = m; floor.dataset.m = m; token++;
    btns.forEach(b => { b.setAttribute('aria-selected', String(b.dataset.m === m)); b.style.setProperty('--dur', (byUser ? 9000 : DUR) + 'ms'); });
    btns.forEach(b => { b.classList.remove('run'); void b.offsetWidth; if (b.dataset.m === m && !RM) b.classList.add('run'); });
    if (byUser) userUntil = Date.now() + 9000;
    a.lift = 0; a.say(LINES[m], 2400);
    if (RM) { a.set(m); return; }
    perform(m, token);
  }
  async function perform(m, my) {
    const alive = () => my === token;
    if (m === 'walk') { while (alive()) { await walkTo(a, .72, .2, alive); if (!alive()) break; await walkTo(a, .28, .2, alive); } }
    else if (m === 'jump') { if (Math.abs(a.x - .5) > .01) await walkTo(a, .5, .3, alive); while (alive()) { await jump(a, 64, 700, null, alive); if (alive()) await wait(260); } }
    else { if (Math.abs(a.x - .5) > .01) await walkTo(a, .5, .3, alive); if (alive()) a.set(m); }
  }
  btns.forEach(b => b.addEventListener('click', () => select(b.dataset.m, true)));
  select('walk');
  // Troca de modo sozinho enquanto ninguém mexe.
  const order = ['walk', 'jump', 'think', 'notebook'];
  setInterval(() => { if (!a.visible || RM || Date.now() < userUntil) return; select(order[(order.indexOf(mode) + 1) % order.length]); }, DUR);
})();

})();
