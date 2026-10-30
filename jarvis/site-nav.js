// Topo das páginas do site (início e /windows): fundo ao rolar, linha de progresso, seção atual acesa e o menu do celular.
// Cada parte só liga se a página tiver o elemento dela.
(() => {
  const nav = document.getElementById('nav'), prog = document.getElementById('prog');
  if (!nav) return;
  const onScroll = () => {
    nav.classList.toggle('sc', scrollY > 30);
    if (prog) { const max = document.documentElement.scrollHeight - innerHeight; prog.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`; }
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Seção atual acesa no topo.
  const links = [...nav.querySelectorAll('nav a[href^="#"]')];
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.hash === '#' + e.target.id)); }), { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(a => { const t = document.getElementById(a.hash.slice(1)); if (t) spy.observe(t); });
  }

  // Menu do celular: abre por cima de tudo, fecha no X, no Esc ou ao escolher a seção.
  const btn = document.getElementById('mBtn'), menu = document.getElementById('mNav');
  if (!btn || !menu) return;
  const set = open => {
    if (open) { menu.hidden = false; requestAnimationFrame(() => menu.classList.add('open')); }
    else { menu.classList.remove('open'); setTimeout(() => { if (!menu.classList.contains('open')) menu.hidden = true; }, 260); }
    btn.setAttribute('aria-expanded', open); btn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    btn.querySelector('use').setAttribute('href', open ? '#i-x' : '#i-menu');
    document.body.classList.toggle('menu-open', open); nav.classList.toggle('menu', open);
  };
  btn.addEventListener('click', () => set(menu.hidden));
  menu.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  matchMedia('(min-width: 901px)').addEventListener('change', e => { if (e.matches && !menu.hidden) set(false); });
})();
