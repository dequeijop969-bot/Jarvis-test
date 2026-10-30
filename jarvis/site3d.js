// Cena 3D do site (apresentação e login): o "núcleo" do Jarvis. Icosaedro em malha, esfera interna que pulsa,
// três anéis girando em eixos diferentes, nuvem de partículas e satélites. Segue o mouse de leve e reage ao scroll.
// Usa o three.js do cdnjs (global THREE). Sem WebGL ou sem o script: o contêiner ganha .no3d e o CSS mostra um orbe estático.
// Movimento reduzido no sistema: desenha um quadro só, parado.
(function () {
  const AMBER = 0xf2b33d, AMBER2 = 0xffc960, TEAL = 0x5fb3a1, SKY = 0x8fb8ff;

  function webglOk() {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch { return false; }
  }

  // Textura de ponto redondo e macio (as partículas não ficam quadradas).
  function dotTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); return t;
  }

  window.JarvisScene = function (host, opts) {
    opts = Object.assign({ scale: 1, particles: 1400, offsetX: 0, scroll: true }, opts || {});
    if (!host) return null;
    if (!window.THREE || !webglOk()) { host.classList.add('no3d'); return null; }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b0c0f, 0.055);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 9.5);

    const core = new THREE.Group(); core.scale.setScalar(opts.scale); scene.add(core);

    // Malha externa (icosaedro) e uma segunda, menor, girando ao contrário.
    const icoGeo = new THREE.IcosahedronGeometry(1.9, 1);
    const ico = new THREE.LineSegments(new THREE.EdgesGeometry(icoGeo), new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: .55 }));
    core.add(ico);
    const ico2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.25, 0)), new THREE.LineBasicMaterial({ color: AMBER2, transparent: true, opacity: .35 }));
    core.add(ico2);
    // Vértices acesos na malha externa.
    const vtx = new THREE.Points(icoGeo, new THREE.PointsMaterial({ color: AMBER2, size: .09, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    core.add(vtx);

    // Núcleo que pulsa: esfera sólida + halo em camadas aditivas.
    const heart = new THREE.Mesh(new THREE.SphereGeometry(.62, 48, 48), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: .9 }));
    core.add(heart);
    const halos = [1.0, 1.45, 2.1].map((r, i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 32), new THREE.MeshBasicMaterial({ color: i ? AMBER : AMBER2, transparent: true, opacity: [.22, .09, .04][i], depthWrite: false, blending: THREE.AdditiveBlending }));
      core.add(m); return m;
    });

    // Anéis.
    const ring = (r, tube, color, op, rx, ry) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 160), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.set(rx, ry, 0); core.add(m); return m;
    };
    const rings = [ring(2.75, .012, AMBER, .75, Math.PI / 2.3, 0), ring(3.25, .008, TEAL, .55, Math.PI / 1.7, .6), ring(3.8, .006, SKY, .35, Math.PI / 2, -.5)];
    // Marcadores de "dados" correndo nos anéis.
    const beads = rings.map((rg, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(.07 - i * .012, 12, 12), new THREE.MeshBasicMaterial({ color: [AMBER2, TEAL, SKY][i] }));
      rg.add(b); return { b, r: rg.geometry.parameters.radius, s: [1.1, -.75, .5][i], a: i * 2 };
    });

    // Satélites: pequenos cubos em malha orbitando longe.
    const sats = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.18, .18, .18)), new THREE.LineBasicMaterial({ color: i % 2 ? TEAL : AMBER, transparent: true, opacity: .8 }));
      scene.add(s); sats.push({ s, r: 4.3 + Math.random() * 1.6, a: Math.random() * Math.PI * 2, y: (Math.random() - .5) * 2.4, v: .12 + Math.random() * .18 });
    }

    // Partículas numa casca esférica (e algumas soltas longe), cor misturando âmbar e ciano.
    const n = opts.particles, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const cA = new THREE.Color(AMBER), cB = new THREE.Color(TEAL), cC = new THREE.Color(0xf1efe9), tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const far = Math.random() < .25, r = far ? 6 + Math.random() * 7 : 4.2 + Math.random() * 1.4;
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, k = Math.sqrt(1 - u * u);
      pos.set([r * k * Math.cos(t), r * u * .75, r * k * Math.sin(t)], i * 3);
      tmp.copy(Math.random() < .55 ? cA : Math.random() < .6 ? cB : cC).multiplyScalar(.6 + Math.random() * .4);
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const dust = new THREE.Points(pg, new THREE.PointsMaterial({ size: .06, map: dotTexture(), vertexColors: true, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(dust);

    // Tamanho, mouse e scroll.
    let w = 0, h = 0;
    function resize() {
      const r = host.getBoundingClientRect(); w = Math.max(1, r.width); h = Math.max(1, r.height);
      renderer.setSize(w, h, false); camera.aspect = w / h;
      // Tela estreita (celular): afasta a câmera para o núcleo inteiro caber.
      camera.position.z = w < h ? 9.5 * Math.min(1.35, Math.max(1, h / w * .6)) : 9.5;
      scene.fog.density = .055 * 9.5 / camera.position.z;   // mais longe, menos neblina: o núcleo continua aceso no celular
      camera.updateProjectionMatrix();
    }
    const ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(host); else addEventListener('resize', resize);
    resize();

    let mx = 0, my = 0, tx = 0, ty = 0, sp = 0;
    addEventListener('pointermove', e => { tx = (e.clientX / innerWidth - .5) * 2; ty = (e.clientY / innerHeight - .5) * 2; }, { passive: true });
    if (opts.scroll) addEventListener('scroll', () => { sp = Math.min(1, scrollY / Math.max(1, innerHeight)); }, { passive: true });

    let visible = true, raf = 0, last = performance.now(), t = 0;
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible && !reduce && !raf) loop(performance.now()); }).observe(host);

    function frame(dt) {
      t += dt;
      mx += (tx - mx) * .04; my += (ty - my) * .04;
      core.rotation.y = t * .18 + mx * .35 + sp * 1.2;
      core.rotation.x = Math.sin(t * .2) * .12 + my * .2;
      ico2.rotation.y = -t * .45; ico2.rotation.z = t * .2;
      const pulse = 1 + Math.sin(t * 2.2) * .06;
      heart.scale.setScalar(pulse); halos.forEach((m, i) => m.scale.setScalar(1 + Math.sin(t * 2.2 - i * .6) * (.05 + i * .03)));
      rings[0].rotation.z = t * .5; rings[1].rotation.z = -t * .32; rings[2].rotation.z = t * .2;
      beads.forEach(o => { o.a += dt * o.s; o.b.position.set(Math.cos(o.a) * o.r, Math.sin(o.a) * o.r, 0); });
      sats.forEach(o => { o.a += dt * o.v; o.s.position.set(Math.cos(o.a) * o.r, o.y + Math.sin(t * .6 + o.r) * .25, Math.sin(o.a) * o.r); o.s.rotation.x += dt * .8; o.s.rotation.y += dt * .6; });
      dust.rotation.y = t * .03 - mx * .1; dust.rotation.x = my * .05;
      camera.position.x = mx * .6 + opts.offsetX; camera.position.y = -my * .4 + sp * 1.2;
      camera.lookAt(opts.offsetX, sp * .6, 0);
      core.position.y = -sp * .8;
      renderer.render(scene, camera);
    }
    function loop(now) {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      frame(dt);
      raf = requestAnimationFrame(loop);
    }
    if (reduce) { t = 2.4; frame(0); addEventListener('resize', () => frame(0)); }
    else raf = requestAnimationFrame(loop);
    host.classList.add('has3d');
    return { renderer, scene };
  };
})();
