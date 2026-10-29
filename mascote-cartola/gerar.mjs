#!/usr/bin/env node
// Jarvis Code de cartola: o mascote em pixel art (corpo preto, cartola com fivela âmbar, casaca com caudas, luvas brancas, olhos ciano).
// Tudo é desenhado aqui por código, sem dependências. Rode: node mascote-cartola/gerar.mjs
// Gera: sprites/<anim>_NN.png (48x48, mesmo padrão de nomes que o Jarvis Desktop e o site usam em /jc/), folhas/<anim>.png (tira horizontal),
//       previa/<anim>.gif e previa/vitrine.gif (ampliados, no fundo do site) e animacoes.json (quadros, fps, se repete).
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --estilo=claw: versão mais fiel ao Claw'd (tocos no lugar dos braços, olhos quadrados, sem bochechas, peito branco e caudas), na pasta claw/
const CLAW = process.argv.includes('--estilo=claw');
// --roupa=correios: uniforme de carteiro (boné azul, polo amarela de gola azul, bolsa a tiracolo), na pasta correios/ (ou claw-correios/)
const CORREIOS = process.argv.includes('--roupa=correios');
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), [CLAW && 'claw', CORREIOS && 'correios'].filter(Boolean).join('-'));
const W = 48, H = 48;

/* ---------- Paleta (grafite, âmbar e ciano do app) ---------- */
const C = {
  out: [8, 7, 14],
  b0: [29, 29, 44], b1: [18, 18, 29], b2: [45, 46, 70], b3: [82, 86, 124], spec: [150, 156, 200],   // corpo preto-azulado: base, sombra, luz, borda, reflexo
  h0: [22, 21, 32], h1: [13, 12, 20], h2: [44, 44, 64], h3: [104, 108, 140],       // cartola de seda
  shirt: [236, 236, 244], shirtD: [168, 170, 192], blush: [158, 66, 100],         // peito da casaca, bochechas
  amb: [242, 179, 61], ambL: [255, 214, 128], ambD: [176, 116, 28],                 // faixa e gravata
  eye: [95, 212, 255], eyeL: [214, 247, 255], eyeD: [44, 120, 150],
  glove: [238, 236, 228], gloveD: [176, 174, 166],
  shoe: [12, 12, 16], shoeL: [120, 124, 142],
  lap: [96, 100, 114], lapL: [150, 154, 168], lapD: [62, 65, 76], keyGlow: [150, 214, 232],
  scr: [95, 212, 255], scrL: [200, 244, 255],
  glow: [34, 72, 90], glowL: [52, 112, 138],                                        // luz da tela no corpo
  white: [241, 239, 233], dust: [118, 120, 132], dustD: [74, 76, 88], pink: [196, 84, 96],
  y0: [246, 196, 40], y1: [200, 146, 22], y2: [255, 226, 112], bl0: [42, 92, 180], bl1: [24, 56, 122], bl2: [98, 148, 228], blV: [20, 44, 100],   // uniforme heart: [255, 105, 140], heartL: [255, 190, 205], anger: [235, 72, 72], sweat: [150, 220, 255],
};

/* ---------- Camadas: cada parte (perna, corpo, cartola, braço...) ganha contorno próprio antes de ir para o quadro ---------- */
class Layer {
  constructor() { this.p = new Array(W * H).fill(null); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) this.p[y * W + x] = c; }
  get(x, y) { return x >= 0 && y >= 0 && x < W && y < H ? this.p[y * W + x] : null; }
  outline(c = C.out) {
    const add = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (!this.get(x, y) && (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))) add.push([x, y]);
    for (const [x, y] of add) this.set(x, y, c);
    return this;
  }
  over(l) { for (let i = 0; i < W * H; i++) if (l.p[i]) this.p[i] = l.p[i]; return this; }
}

const rect = (l, x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) l.set(x, y, c); };
function linePts(x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, pts = [];
  for (let err = dx + dy; ;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return pts;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
const line = (l, x0, y0, x1, y1, c, w = 1) => linePts(x0, y0, x1, y1).forEach(([x, y]) => w === 1 ? l.set(x, y, c) : rect(l, x - 1, y - 1, x + 1, y + 1, c));
const stamp = (l, x, y, rows, c) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') l.set(x + i, y + j, typeof c === 'function' ? c(ch) : c); }));

// Fonte 3x5 (rótulos da vitrine e os símbolos de código que saem do notebook)
const FONT = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], G: ['.##', '#..', '#.#', '#.#', '.##'], I: ['###', '.#.', '.#.', '.#.', '###'],
  L: ['#..', '#..', '#..', '#..', '###'], M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['###', '#.#', '#.#', '#.#', '###'], P: ['##.', '#.#', '##.', '#..', '#..'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  F: ['###', '#..', '##.', '#..', '#..'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'], Z: ['###', '..#', '.#.', '#..', '###'],
  '?': ['##.', '..#', '.#.', '...', '.#.'], '!': ['#', '#', '#', '.', '#'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'], '>': ['#..', '.#.', '..#', '.#.', '#..'], '/': ['..#', '..#', '.#.', '#..', '#..'],
  '{': ['.##', '.#.', '#..', '.#.', '.##'], '}': ['##.', '.#.', '..#', '.#.', '##.'], ';': ['...', '.#.', '...', '.#.', '#..'],
};
const Z4 = ['####', '..#.', '.#..', '####'], Z5 = ['#####', '...#.', '..#..', '.#...', '#####'];

/* ---------- Cartola: 17x12, o ponto (8,11) é o centro de baixo da aba ---------- */
const crown = (a, b, c, d, e) => a + b + c + d.repeat(7) + e;   // 11 colunas
const HAT = [
  '...' + crown('a', 'A', 'a', 'a', 'b') + '...',
  ...Array(6).fill('...' + crown('a', 'A', 'a', 'o', 'b') + '...'),
  '...' + crown('Y', 'Y', 'y', 'y', 'd').slice(0, 7) + 'WW' + 'yd' + '...',   // faixa âmbar com fivela
  '...' + crown('y', 'd', 'd', 'd', 'd').slice(0, 7) + 'Wk' + 'dd' + '...',
  'a..' + crown('a', 'A', 'a', 'o', 'b') + '..a',               // pontas da aba viradas para cima
  'aaaaaaoooooooobbb',
  '.bbbbbbbbbbbbbbb.',
];
if (HAT.some(r => r.length !== 17)) throw new Error('cartola torta');
const HATC = { W: C.ambL, k: C.ambD, a: C.h2, A: C.h3, o: C.h0, b: C.h1, Y: C.ambL, y: C.amb, d: C.ambD };
// Boné do carteiro: de lado (aba para a frente) e de frente (aba larga embaixo); 17x7, apoio em (8,6)
const CAP_S = ['.......Y.........', '....LLBBBBBD.....', '...LBBBBBBBBD....', '...LBBBBBBBBBD...', '...YYYYYYYYYYy...', '...BBBBBBBBBBVVVV', '...DDDDDDDDDDVVV.'];
const CAP_F = ['........Y........', '....LLBBBBBBD....', '...LBBBBBBBBBD...', '...LBBBBBBBBBD...', '...YYYYYYYYYYy...', '..VVVVVVVVVVVVV..', '...DDDDDDDDDDD...'];
if ([...CAP_S, ...CAP_F].some(r => r.length !== 17)) throw new Error('boné torto');
const CAPC = { L: C.bl2, B: C.bl0, D: C.bl1, V: C.blV, Y: C.y0, y: C.y1 };
const HAT_HEAD = CORREIOS ? [8, 6] : [8, 11], HAT_GRIP = CORREIOS ? [14, 7] : [14, 12];   // apoio na cabeça; onde a mão segura (logo abaixo da aba, à direita)
function drawHat(l, wx, wy, rot, pivot, view = 'side') {
  const grid = CORREIOS ? (view === 'front' ? CAP_F : CAP_S) : HAT, colors = CORREIOS ? CAPC : HATC;
  wx = Math.round(wx); wy = Math.round(wy);
  const a = rot * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  for (let y = wy - 24; y <= wy + 24; y++) for (let x = wx - 24; x <= wx + 24; x++) {
    const dx = x - wx, dy = y - wy;
    const ch = grid[Math.round(-dx * sin + dy * cos + pivot[1])]?.[Math.round(dx * cos + dy * sin + pivot[0])];
    if (ch && ch !== '.') l.set(x, y, colors[ch]);
  }
}

/* ---------- O personagem ----------
   Pose: view 'side' (olhando para a direita, o site espelha para a esquerda) ou 'front'; bx/by deslocam o corpo; rx/ry achatam/esticam;
   lean inclina (graus, + = para frente) em torno de baixo do corpo (ou do topo com pivot 'top'); hands em coordenadas do corpo
   (relativas ao centro; handsW em pixels do quadro); feet: deslocamento dos pés no chão (feetLocal: pés presos ao corpo, pendurado). */
const BASE = { cx: 24, cy: 35, rx: 9, ry: 10 };   // medidas de referência das poses (rosto, mãos, pés são dados nelas)
const SHAPE = { rx: 10, ry: 7, n: 14 };             // o corpo de verdade: um bloco reto, como o Claw'd (superelipse quase retangular)
const DEF = {
  view: 'side', bx: 0, by: 0, rx: 0, ry: 0, lean: 0, pivot: 'bottom', eyes: 'open', look: [0, 0], mouth: null,
  feet: [[0, 0], [0, 0]], feetLocal: null, hands: [[-10, 5], [10, 5]], handsW: null, behind: [false, false],
  hat: { dx: 0, dy: 0, rot: 0 }, hatHand: null, tail: 30, glow: false, props: [], fx: [],
};

function geo(p) {
  const RX = SHAPE.rx + p.rx, RY = SHAPE.ry + p.ry, cx = BASE.cx + p.bx, cy = BASE.cy + p.by;
  const a = p.lean * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const px = cx, py = p.pivot === 'top' ? cy - RY : cy + RY;
  return {
    RX, RY, a,
    L(lx, ly) { const dx = lx * RX / BASE.rx, dy = ly * RY / BASE.ry + cy - py; return [px + dx * cos - dy * sin, py + dx * sin + dy * cos]; },
    inv(x, y) { const dx = x - px, dy = y - py; return [dx * cos + dy * sin, -dx * sin + dy * cos + py - cy]; },
  };
}

function drawBody(l, p, g) {
  const lx = -0.55, ly = -0.83, side = p.view === 'side';   // luz de cima à esquerda
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [ux, uy] = g.inv(x, y), nx = ux / (g.RX + 0.5), ny = uy / (g.RY + 0.5), N = SHAPE.n, r = (Math.abs(nx) ** N + Math.abs(ny) ** N) ** (1 / N);
    if (r > 1) continue;
    const gx = Math.sign(nx) * Math.abs(nx) ** (N - 1), gy = Math.sign(ny) * Math.abs(ny) ** (N - 1), gl = Math.hypot(gx, gy) || 1;   // normal da superelipse
    const wx = (gx * Math.cos(g.a) - gy * Math.sin(g.a)) / gl, wy = (gx * Math.sin(g.a) + gy * Math.cos(g.a)) / gl, d = wx * lx + wy * ly;
    const chk = (x + y) % 2 === 0;   // pontilhado entre os tons
    let c = C.b0;
    if (r > 0.8 && d > 0.5) c = C.b3;
    else if (r > 0.5 && d > 0.3) c = C.b2;
    else if (r > 0.42 && d > 0.3 && chk) c = C.b2;
    else if (r > 0.68 && d < -0.4) c = C.b1;
    else if (r > 0.58 && d < -0.4 && chk) c = C.b1;
    if (Math.hypot(nx + 0.42, ny + 0.5) < 0.13) c = C.spec;                       // reflexo
    else if (Math.hypot(nx + 0.42, ny + 0.5) < 0.2 && chk) c = C.b3;
    if (!CLAW) {
      // peito branco da casaca: estreito no colarinho, abre para baixo
      const bx = ux * BASE.rx / g.RX - (side ? 4 : 0), by = uy * BASE.ry / g.RY;
      if (by >= 3 && by <= 10 && r < (side ? 0.97 : 0.9) && Math.abs(bx) <= 0.8 + (by - 3) * 0.45) c = bx > 0.6 + (by - 3) * 0.3 || r > 0.8 ? C.shirtD : C.shirt;
      if (Math.abs(bx) < 0.5 && Math.abs(by - 9) < 0.5) c = C.b1;                    // botão
    }
    if (CORREIOS) {   // polo amarela da metade para baixo, gola azul
      const bx = ux * BASE.rx / g.RX - (side ? 4 : 0), by = uy * BASE.ry / g.RY;
      if (by >= 1) {
        c = r > 0.82 && d > 0.45 ? C.y2 : d > 0.3 && r > 0.5 ? (chk || r > 0.7 ? C.y2 : C.y0) : d < -0.4 && r > 0.6 ? C.y1 : C.y0;
        if (by < 2.2) c = C.bl0;
      }
    }
    if (p.glow && r > 0.62 && wx > 0.55 && wy < 0.6) c = r > 0.86 ? C.glowL : C.glow;
    l.set(x, y, c);
  }
}

// Caudas da casaca (só de lado): saem das costas e balançam conforme p.tail (graus a partir de "pendurada")
function tri(l, a, b, c, col) {
  const [x0, x1] = [Math.min(a[0], b[0], c[0]), Math.max(a[0], b[0], c[0])].map(Math.round), [y0, y1] = [Math.min(a[1], b[1], c[1]), Math.max(a[1], b[1], c[1])].map(Math.round);
  const e = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const s1 = e(a, b, x, y), s2 = e(b, c, x, y), s3 = e(c, a, x, y);
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) l.set(x, y, col);
  }
}
function drawTail(l, p, g, k) {
  const t = (p.tail + p.lean + k * 14) * Math.PI / 180, len = 6 - k;
  const top = g.L(-6, 3), bot = g.L(-3, 9), base = [(top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2];
  tri(l, top, bot, [base[0] - Math.sin(t) * len, base[1] + Math.cos(t) * len], k ? C.b1 : C.b0);
}

// Olhos: caixa de 3x3 a partir de (x, y) no estilo claw (2 de largura no outro). Expressões: open, blink, closed, squint (concentrado),
// happy (^), wide (arregalado), star (empolgado), heart (apaixonado), x (tonto), sad (caído).
function eye(l, x, y, k, i = 0) {
  const w = CLAW ? 2 : 1;   // largura - 1
  if (k === 'open' && CLAW) { rect(l, x, y, x + 2, y + 2, C.eye); l.set(x, y, C.eyeL); }
  else if (k === 'open') { rect(l, x, y - 1, x + 1, y + 2, C.eye); l.set(x, y - 1, C.eyeL); l.set(x, y, C.eyeL); rect(l, x, y + 2, x + 1, y + 2, C.eyeD); l.set(x, y + 2, C.eye); }
  else if (k === 'wide') { rect(l, x, y - 1, x + w, y + 2, C.eye); rect(l, x, y - 1, x + w, y - 1, C.eyeL); l.set(x, y, C.eyeL); }
  else if (k === 'blink') rect(l, x, y + 2, x + w, y + 2, C.eye);
  else if (k === 'closed') rect(l, x, y + 2, x + w, y + 2, C.eyeD);
  else if (k === 'squint') rect(l, x, y + 1, x + w, y + 2, C.eye);
  else if (k === 'happy' && CLAW) { l.set(x, y + 2, C.eye); l.set(x + 1, y + 1, C.eye); l.set(x + 2, y + 2, C.eye); }
  else if (k === 'happy') { l.set(x - 1, y + 2, C.eye); rect(l, x, y + 1, x + 1, y + 1, C.eye); l.set(x + 2, y + 2, C.eye); }
  else if (k === 'star') { l.set(x + 1, y, C.ambL); rect(l, x, y + 1, x + 2, y + 1, C.ambL); l.set(x + 1, y + 2, C.ambL); l.set(x + 1, y + 1, C.white); }
  else if (k === 'heart') { l.set(x, y, C.heart); l.set(x + 2, y, C.heart); rect(l, x, y + 1, x + 2, y + 1, C.heart); l.set(x + 1, y + 2, C.heart); l.set(x, y, C.heartL); }
  else if (k === 'x') { l.set(x, y, C.eye); l.set(x + 2, y, C.eye); l.set(x + 1, y + 1, C.eye); l.set(x, y + 2, C.eye); l.set(x + 2, y + 2, C.eye); }
  else if (k === 'sad') { rect(l, x, y + 1, x + w, y + 2, C.eye); l.set(i ? x : x + w, y + 1, C.eyeL); }
}
// Sobrancelhas (cinza-claro, logo acima dos olhos): angry (franzidas), sad (caídas), up (uma desconfiada, outra erguida)
function brow(l, x, y, k, i) {
  const c = C.shirtD, pts = {
    angry: i ? [[0, -1], [1, -2], [2, -2]] : [[0, -2], [1, -2], [2, -1]],
    sad: i ? [[0, -2], [1, -2], [2, -1]] : [[0, -1], [1, -2], [2, -2]],
    up: i ? [[0, -2], [1, -3], [2, -2]] : [[0, -1], [1, -1], [2, -1]],
  }[k];
  pts?.forEach(([dx, dy]) => l.set(x + dx, y + dy, c));
}

const BOW = { L: C.ambL, A: C.amb, K: C.ambD, D: C.ambD };
function drawFace(l, p, g) {
  const side = p.view === 'side', kinds = Array.isArray(p.eyes) ? p.eyes : [p.eyes, p.eyes], r = v => v.map(Math.round);
  (side ? [[1, -4], [6, -4]] : [[-4, -4], [3, -4]]).forEach(([x, y], i) => {
    const [ex, ey] = r(g.L(x + p.look[0], y + p.look[1])), [cx, cy] = r(g.L(x, y));
    const bl = i ? cx + 2 : cx - 2; if (!CLAW) { l.set(bl, cy + 3, C.blush); l.set(bl + (i ? -1 : 1), cy + 3, C.blush); }   // bochechas
    eye(l, ex, ey, kinds[i], i);
    if (p.brows) brow(l, ex, ey, p.brows, i);
  });
  const [tx, ty] = r(g.L(side ? 5 : 0, 5));
  if (!CORREIOS) stamp(l, tx - 2, ty, ['LA.LA', 'AAKAA', 'DD.DD'], ch => BOW[ch]);   // gravata-borboleta
  if (!p.mouth) return;
  const [mx, my] = r(g.L(side ? 4 : 0, 0));
  const m = (pts, c = C.b3) => pts.forEach(([dx, dy]) => l.set(mx + dx, my + dy, c));
  if (p.mouth === 'smile') m([[-1, 0], [0, 1], [1, 0]]);
  else if (p.mouth === 'grin') { m([[-2, 0], [2, 0]]); rect(l, mx - 1, my + 1, mx + 1, my + 1, C.white); m([[-1, 2], [0, 2], [1, 2]], C.pink); }
  else if (p.mouth === 'flat') m([[-1, 1], [0, 1], [1, 1]]);
  else if (p.mouth === 'frown') m([[-1, 1], [0, 0], [1, 1]]);
  else if (p.mouth === 'wavy') m([[-2, 1], [-1, 0], [0, 1], [1, 0], [2, 1]]);
  else if (p.mouth === 'tongue') { m([[-1, 0], [0, 0], [1, 0]]); m([[1, 1]], C.pink); }
  else { rect(l, mx - 1, my, mx, my, C.out); rect(l, mx - 1, my + 1, mx, my + 1, C.pink); }
}

// Quatro perninhas retas, como as do Claw'd. Pares alternados: as pernas 0 e 2 seguem feet[0], as 1 e 3 seguem feet[1].
const LEGS = [-7, -3, 3, 7];
function drawLeg(l, p, g, k) {
  const pair = k % 2, off = LEGS[k], lx = off * BASE.rx / SHAPE.rx, hip = g.L(lx, 8);
  const [fx, fy] = (p.feetLocal ? g.L(lx + (p.feetLocal[pair][0] - (pair ? 3 : -3)) * 0.5, p.feetLocal[pair][1])
    : [BASE.cx + off + p.feet[pair][0] * 0.5, 46 + p.feet[pair][1]]).map(Math.round);
  const col = pair ? C.b0 : C.b1;
  for (const [x, y] of linePts(hip[0] - 0.5, hip[1], fx - 0.5, fy)) { l.set(x, y, col); l.set(x + 1, y, col); }
}

function handPos(p, g, i) {
  const h = p.handsW?.[i] || g.L(...p.hands[i]);
  if (!CLAW) return h;
  const e = g.L(i ? 8 : -8, 1);   // o toco sai de lado; só sobe quando a mão sobe (acenar, cartola)
  return [e[0] + (i ? 5 : -5), e[1] + Math.max(-7, Math.min(1, (h[1] - e[1]) * 0.6))];
}
function drawArm(l, p, g, i) {
  if (CLAW) {   // toco retangular, como o do Claw'd
    const [ex, ey] = g.L(i ? 8 : -8, 2), [hx, hy] = handPos(p, g, i);
    for (const [x, y] of linePts(ex, ey, hx, hy)) rect(l, x - 1, y - 2, x + 2, y + 1, CORREIOS ? C.y0 : C.b0);   // de carteiro, o toco é a manga amarela
    return;
  }
  const [sx, sy] = g.L(i ? 7 : -7, 2), [hx, hy] = handPos(p, g, i).map(Math.round);
  const pts = linePts(sx, sy, hx, hy), cuff = pts.filter(([x, y]) => Math.abs(x - hx) > 1 || Math.abs(y - hy) > 1).pop();
  line(l, sx, sy, hx, hy, CORREIOS ? (i ? C.y0 : C.y1) : i ? C.b0 : C.b1);
  if (cuff) l.set(cuff[0], cuff[1], C.shirt);   // punho branco
  rect(l, hx - 1, hy - 1, hx + 1, hy + 1, C.glove);
  l.set(hx + 1, hy, C.gloveD); l.set(hx + 1, hy + 1, C.gloveD); l.set(hx, hy + 1, C.gloveD);
}

// Bolsa de carteiro: alça cruzando o peito, bolsa azul de aba amarela na altura do quadril, uma carta aparecendo
function drawStrap(l, p, g) { const [ax, ay] = g.L(-9, 3), [bx, by] = g.L(6, 6); line(l, ax, ay, bx, by, C.bl1); }
function drawBag(l, p, g) {
  const [cx, cy] = g.L(7, 8).map(Math.round);
  rect(l, cx - 1, cy - 3, cx, cy - 2, C.white); l.set(cx, cy - 3, C.pink);   // carta com selo
  rect(l, cx - 2, cy - 1, cx + 2, cy + 2, C.bl0); rect(l, cx - 2, cy + 2, cx + 2, cy + 2, C.bl1);
  rect(l, cx - 2, cy - 1, cx + 2, cy - 1, C.y0); l.set(cx, cy, C.y1);   // aba e fecho
}

function render(pose) {
  const p = { ...DEF, ...pose, hat: { ...DEF.hat, ...pose.hat } }, g = geo(p), frame = new Layer();
  const part = fn => { const l = new Layer(); fn(l); frame.over(l.outline()); };
  [0, 1].forEach(i => { if (p.behind[i] || CLAW) part(l => drawArm(l, p, g, i)); });   // no estilo claw os tocos saem de trás do corpo
  [0, 2, 1, 3].forEach(k => part(l => drawLeg(l, p, g, k)));   // par de trás primeiro
  if (p.view === 'side' && !CLAW) { part(l => drawTail(l, p, g, 1)); part(l => drawTail(l, p, g, 0)); }
  part(l => { drawBody(l, p, g); drawFace(l, p, g); });
  if (CORREIOS) { part(l => drawStrap(l, p, g)); part(l => drawBag(l, p, g)); }
  if (!p.hatHand) part(l => { const [x, y] = g.L(0, -10); drawHat(l, x + p.hat.dx, y + p.hat.dy, p.hat.rot + p.lean, HAT_HEAD, p.view); });
  p.props.forEach(pr => part(pr));
  if (p.hatHand) part(l => { const [x, y] = handPos(p, g, 1); drawHat(l, x, y, p.hatHand.rot, HAT_GRIP, p.view); });
  [0, 1].forEach(i => { if (!p.behind[i] && !CLAW) part(l => drawArm(l, p, g, i)); });
  [...p.fx, ...(p.fx2 || [])].forEach(f => part(f));
  return frame;
}

/* ---------- Objetos e efeitos ---------- */
const laptop = f => l => {
  rect(l, 32, 45, 43, 45, C.lapL); rect(l, 32, 46, 43, 46, C.lap);
  for (let x = 33; x <= 37; x += 2) l.set(x, 45, C.lap);              // teclas
  rect(l, 38, 45, 41, 45, C.keyGlow);                                 // luz da tela no teclado
  for (const [x, y] of linePts(42, 44, 44, 34)) { l.set(x, y, (y + f) % 4 === 0 ? C.scrL : C.scr); l.set(x + 1, y, C.lapD); }   // tampa: tela virada para ele
};
const HEART = ['.#.#.', '#####', '.###.', '..#..'], ANGER = ['.#.#.', '##.##', '.....', '##.##', '.#.#.'], ANGER_S = ['#.#', '...', '#.#'];
const FX = {
  mark: (ch, x, y, c = C.white) => l => stamp(l, x, y, FONT[ch], c),
  heart: (x, y) => l => { stamp(l, x, y, HEART, C.heart); l.set(x + 1, y, C.heartL); },
  anger: (x, y, big) => l => stamp(l, x, y, big ? ANGER : ANGER_S, C.anger),
  tear: (x, y) => l => { l.set(x, y, C.sweat); rect(l, x, y + 1, x, y + 1, C.sweat); l.set(x, y + 1, C.white); },
  dots: n => l => [[36, 12], [40, 12], [44, 12]].slice(0, n).forEach(([x, y]) => rect(l, x, y, x + 1, y + 1, C.white)),
  glyph: (ch, x, y, c) => l => stamp(l, x, y, FONT[ch], c),
  z: (x, y, big) => l => stamp(l, x, y, big ? Z5 : Z4, C.white),
  sweat: (x, y) => l => { l.set(x + 1, y, C.sweat); rect(l, x, y + 1, x + 1, y + 2, C.sweat); l.set(x, y + 1, C.white); },
  dust: (x, y, s) => l => {
    if (s === 1) rect(l, x, y, x + 1, y, C.dust);
    else if (s === 2) { rect(l, x - 1, y - 1, x + 1, y, C.dust); l.set(x + 2, y, C.dustD); }
    else { l.set(x - 1, y - 2, C.dustD); l.set(x + 1, y - 1, C.dustD); }
  },
  spark: (x, y) => l => { l.set(x, y - 1, C.ambL); l.set(x - 1, y, C.ambL); l.set(x + 1, y, C.ambL); l.set(x, y + 1, C.ambL); l.set(x, y, C.white); },
};

/* ---------- Animações ---------- */
const sq = k => ({ by: k / 2, ry: -k / 2, rx: k / 4 });   // respira/achata: o topo desce k px, a base fica no chão
const lag = (arr, i) => Math.max(-1, Math.min(1, arr[(i + arr.length - 1) % arr.length] - arr[i]));   // a cartola chega um quadro atrasada
const ANIM = {};

{ // parado: respira, pisca
  const K = [0, 0, 0, 1, 1, 1, 1, 0];
  ANIM.idle = { nome: 'parado', fps: 6, loop: true, frames: K.map((k, i) => ({ ...sq(k), eyes: i === 5 ? 'blink' : 'open', hat: { dy: lag(K, i) } })) };
}

{ // andar: pé da frente ao longo do passo; o de trás vai meio ciclo depois
  const FD = [[3, 0], [2, 0], [0, 0], [-2, 0], [-3, 0], [-2, -1], [0, -2], [2, -1]], BOB = [0, 1, -1, 0, 0, 1, -1, 0];
  ANIM.walk = { nome: 'andar', fps: 10, loop: true, frames: FD.map((front, i) => {
    const back = FD[(i + 4) % 8];
    return { tail: 32 - BOB[i] * 10, by: BOB[i], ...(BOB[i] > 0 ? { rx: 0.5, ry: -0.5 } : {}), feet: [back, front], hat: { dy: lag(BOB, i) },
      hands: [[-10 - back[0] * 0.8, 5 - Math.abs(back[0]) * 0.4], [10 - front[0] * 0.8, 5 - Math.abs(front[0]) * 0.4]] };
  }) };
}

{ // correr: inclinado, passadas longas, braços dobrados, poeira a cada passo
  const FD = [[5, 0], [3, 0], [0, 0], [-3, 0], [-5, -1], [-3, -3], [0, -4], [3, -2]], BOB = [0, 1, -1, -1, 0, 1, -1, -1];
  ANIM.run = { nome: 'correr', fps: 14, loop: true, frames: FD.map((front, i) => {
    const back = FD[(i + 4) % 8], dust = [[14, 45, 1], [12, 44, 2], [10, 43, 3], null][i % 4];
    return { tail: 72 + (i % 2) * 10, lean: 8, by: BOB[i], feet: [back, front], eyes: 'squint', look: [1, 0], hat: { dy: lag(BOB, i), rot: -6 },
      hands: [[-11 - back[0] * 0.4, 3 - Math.abs(back[0]) * 0.3], [11 - front[0] * 0.4, 3 - Math.abs(front[0]) * 0.3]],
      fx: dust ? [FX.dust(...dust)] : [] };
  }) };
}

// pular: agacha, estica, encolhe as pernas no alto, a cartola flutua na descida, aterrissa achatado (o site sobe o quadro por fora)
ANIM.jump = { nome: 'pular', fps: 14, loop: false, frames: [
  { tail: 22, by: 3, ry: -2, rx: 1, eyes: 'squint', hands: [[-11, 6], [11, 6]], hat: { dy: -1 } },
  { tail: 6, by: -2, ry: 2, rx: -1, feet: [[-1, -1], [1, -2]], hands: [[-9, -9], [9, -9]], hat: { dy: 2 } },
  { tail: 14, by: -2, ry: 1, rx: -0.5, feet: [[-2, -3], [1, -3]], hands: [[-12, -3], [12, -3]], hat: { dy: 1 } },
  { tail: 45, by: -2, feet: [[-1, -4], [2, -4]], hands: [[-12, -5], [12, -5]], eyes: 'happy', hat: { dy: -1 } },
  { tail: 75, by: -2, feet: [[-1, -3], [1, -3]], hands: [[-11, -7], [11, -7]], eyes: 'happy', hat: { dy: -3, rot: 4 } },
  { tail: 115, by: -1, ry: 1, feet: [[-1, -1], [1, -1]], hands: [[-10, -9], [10, -9]], eyes: 'wide', hat: { dy: -4, rot: 8 } },
  { tail: 50, by: 3, ry: -2.5, rx: 1.5, feet: [[-2, 0], [2, 0]], hands: [[-12, 5], [12, 5]], eyes: 'squint', hat: { dy: -1, rot: 3 } },
  { tail: 30,},
] };

// pensar: mão no queixo, a outra cruzada na barriga, olhar para cima, bate o pé, reticências
ANIM.think = { nome: 'pensar', fps: 6, loop: true, frames: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({
  hands: [[0, 7], [8, 0]], look: i < 4 ? [0, -1] : [-1, -1], eyes: i === 6 ? 'blink' : 'open',
  feet: [[0, 0], [0, i % 2 ? -1 : 0]], fx: [FX.dots([0, 1, 1, 2, 2, 3, 3, 3][i])],
})) };

{ // digitar (notebook): sentado no chão com o notebook, mãos alternando, uma pausa para ler, um Enter caprichado, símbolos subindo
  let seed = 7, last = 'L';
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const sit = { by: 4, ry: -0.5, rx: 0.5 };
  const GLYPHS = [[0, '<', C.scr], [8, '/', C.amb], [16, '>', C.scr], [32, '{', C.amb], [40, '}', C.scr]];
  // A cara muda enquanto digita: concentrado de língua de fora, contente quando o código sai, confuso na pausa, "aha!", determinado, Enter com estrelas.
  const typingFace = f => {
    if (f < 12) return { eyes: 'squint', mouth: 'tongue' };
    if (f < 20) return { eyes: 'happy', mouth: 'smile' };
    if (f < 24) return { eyes: f === 22 ? 'blink' : 'open' };
    if (f < 30) return { eyes: ['squint', 'open'], brows: 'up', mouth: 'wavy', fx2: [FX.mark('?', 39, 20 - (f % 2))] };
    if (f < 34) return { eyes: 'wide', mouth: 'o', fx2: [FX.mark('!', 40, 19)] };
    if (f < 44) return { eyes: 'squint', brows: 'angry', mouth: 'flat' };
    if (f === 44) return { eyes: 'squint', brows: 'angry', mouth: 'grin' };
    return { eyes: f === 45 ? 'star' : 'happy', mouth: 'grin' };
  };
  ANIM.notebook = { nome: 'digitar', fps: 12, loop: true, frames: Array.from({ length: 48 }, (_, f) => {
    const pause = f >= 24 && f < 30;
    let L = [34, 42], R = [38, 42], fx = [];
    if (pause) { L = [34, 41]; R = [39, 41]; }
    else if (f === 44) R = [40, 39];
    else if (f === 45) { R = [40, 43]; fx.push(FX.spark(42, 40)); }
    else {
      const hand = last === 'L' ? (rnd() < 0.8 ? 'R' : 'L') : (rnd() < 0.8 ? 'L' : 'R'); last = hand;
      if (hand === 'L') L = [rnd() < 0.5 ? 34 : 35, 43]; else R = [rnd() < 0.5 ? 38 : 40, 43];
    }
    for (const [t0, ch, c] of GLYPHS) { const age = f - t0; if (age >= 0 && age < 7) fx.push(FX.glyph(ch, 36 + (age >= 3 ? 1 : 0), 32 - age, c)); }
    return { ...sit, tail: 78, feet: [[5, 0], [4, 0]], glow: true, behind: [true, false], handsW: [L, R], props: [laptop(f)], fx,
      look: pause ? [1, 0] : [1, 1], ...typingFace(f), hat: { dy: f === 45 ? -1 : f >= 30 && f < 34 ? -2 : 0 } };
  }) };
}

{ // acenar: de frente, sorrindo, a cartola de lado
  const K = [0, 0, 1, 1, 0, 0, 1, 1], WX = [11, 13, 11, 9, 11, 13, 11, 9];
  ANIM.wave = { nome: 'acenar', fps: 8, loop: true, frames: K.map((k, i) => ({
    view: 'front', ...sq(k), eyes: 'happy', mouth: 'smile', hands: [[-10, 5], [WX[i], -9 + (i % 2)]], hat: { dy: lag(K, i) },
  })) };
}

// cumprimentar: leva a mão à aba, ergue a cartola, inclina a cabeça e devolve
ANIM.tiphat = { nome: 'cumprimentar', fps: 8, loop: false, frames: [
  {},
  { hands: [[-10, 5], [9, -3]] },
  { hands: [[-10, 5], [6, -9]] },
  { hands: [[-10, 5], [6, -12]], hatHand: { rot: 0 }, eyes: 'happy' },
  { lean: 6, hands: [[1, 6], [6, -14]], hatHand: { rot: 8 }, eyes: 'happy' },
  { lean: 12, hands: [[1, 6], [7, -15]], hatHand: { rot: 14 }, eyes: 'happy', mouth: 'smile' },
  { lean: 12, hands: [[1, 6], [7, -15]], hatHand: { rot: 14 }, eyes: 'happy', mouth: 'smile', fx: [FX.spark(40, 10)] },
  { lean: 12, hands: [[1, 6], [7, -15]], hatHand: { rot: 14 }, eyes: 'happy', mouth: 'smile', fx: [FX.spark(42, 7)] },
  { lean: 6, hands: [[1, 6], [6, -14]], hatHand: { rot: 6 }, eyes: 'happy' },
  { hands: [[-10, 5], [6, -12]], hatHand: { rot: 0 } },
  { hands: [[-10, 5], [6, -9]] },
  { eyes: 'happy', mouth: 'smile' },
] };

{ // arrastado: pendurado pelo topo, balança, esperneia, gota de suor
  const SW = [8, 5, 0, -5, -8, -5, 0, 5];
  ANIM.drag = { nome: 'arrastado', fps: 10, loop: true, frames: SW.map((s, i) => ({
    pivot: 'top', tail: 12 - s, lean: s * 0.8, by: -3, ry: 1.5, rx: -0.5, eyes: 'wide', mouth: 'o',
    feetLocal: [[-3, 14 + (i % 2)], [3, 14 + ((i + 1) % 2)]], hands: [[-12, i % 2 ? -5 : -3], [12, i % 2 ? -3 : -5]],
    hat: { rot: -12 + s * 0.5, dy: -1 }, fx: i < 4 ? [FX.sweat(12, 19 + i)] : [],
  })) };
}

{ // dormir: sentado, cartola sobre os olhos, respiração funda, zzz
  const K = [0, 0, 1, 1, 2, 2, 1, 1];
  ANIM.sleep = { nome: 'dormir', fps: 4, loop: true, frames: K.map((k, i) => {
    const fx = [i, (i + 4) % 8].filter(a => a < 7).map(a => FX.z(33 + a, 21 - a * 2, a >= 3));
    return { tail: 82, by: 4 + k / 2, ry: -0.5 - k / 2, rx: 0.5 + k / 4, eyes: 'closed', hat: { dy: 4, rot: 6 }, hands: [[-10, 8], [10, 8]], feet: [[2, 0], [4, 0]], fx };
  }) };
}

/* ---------- PNG e GIF sem dependências ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, at) {   // at(x, y) -> [r, g, b] ou null (transparente)
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y), o = y * (w * 4 + 1) + 1 + x * 4;
    if (c) { raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function lzw(idx, min) {
  const clear = 1 << min, eoi = clear + 1, out = [];
  let size = min + 1, next = eoi + 1, dict = new Map(), cur = 0, bits = 0;
  const emit = c => { cur |= c << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let pre = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = pre * 256 + k, got = dict.get(key);
    if (got !== undefined) { pre = got; continue; }
    emit(pre);
    if (next === 4096) { emit(clear); dict = new Map(); size = min + 1; next = eoi + 1; }
    else { if (next >= 1 << size) size++; dict.set(key, next++); }
    pre = k;
  }
  emit(pre); emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}
function gif(w, h, frames, delays) {   // frames: Int32Array de cores 0xRRGGBB (w*h)
  const pal = new Map();
  for (const f of frames) for (const c of f) if (!pal.has(c)) pal.set(c, pal.size);
  if (pal.size > 256) throw new Error('cores demais para GIF');
  let bitsPal = 1; while (1 << bitsPal < pal.size) bitsPal++;
  const min = Math.max(2, bitsPal), table = Buffer.alloc(3 << bitsPal);
  for (const [c, i] of pal) { table[i * 3] = c >> 16; table[i * 3 + 1] = (c >> 8) & 255; table[i * 3 + 2] = c & 255; }
  const u16 = n => [n & 255, n >> 8], parts = [Buffer.from('GIF89a'), Buffer.from([...u16(w), ...u16(h), 0xf0 | (bitsPal - 1), 0, 0]), table,
    Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0])];
  frames.forEach((f, n) => {
    const data = lzw(Array.from(f, c => pal.get(c)), min), blocks = [];
    for (let i = 0; i < data.length; i += 255) { const b = data.slice(i, i + 255); blocks.push(b.length, ...b); }
    parts.push(Buffer.from([0x21, 0xf9, 4, 0, ...u16(delays[n]), 0, 0, 0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0, min, ...blocks, 0]));
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

/* ---------- Prévias: o quadro ampliado no fundo do site, com chão ---------- */
const rgb = c => (c[0] << 16) | (c[1] << 8) | c[2];
const BG = rgb([20, 22, 26]), FLOOR = rgb([27, 30, 35]), FLOOR_L = rgb([38, 41, 49]), LABEL = rgb([163, 160, 154]);
class Pic {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Int32Array(w * h).fill(BG); }
  fill(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c; }
  blit(layer, ox, oy) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = layer.get(x, y); if (c) this.fill(ox + x, oy + y, ox + x, oy + y, rgb(c)); } }
  text(s, cx, y, c) {
    const glyphs = [...s].map(ch => FONT[ch] || ['', '', '', '', '']), width = glyphs.reduce((a, g) => a + (g[0].length || 2) + 1, -1);
    let x = Math.round(cx - width / 2);
    for (const g of glyphs) { g.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') this.fill(x + i, y + j, x + i, y + j, c); })); x += (g[0].length || 2) + 1; }
  }
  scaled(s) { const out = new Int32Array(this.w * s * this.h * s); for (let y = 0; y < this.h * s; y++) for (let x = 0; x < this.w * s; x++) out[y * this.w * s + x] = this.px[((y / s) | 0) * this.w + ((x / s) | 0)]; return out; }
}
const STAGE_W = 64, STAGE_H = 64;
function stage(pic, ox, oy, layer, lift = 0) {
  pic.fill(ox, oy + 60, ox + STAGE_W - 1, oy + STAGE_H - 1, FLOOR); pic.fill(ox, oy + 60, ox + STAGE_W - 1, oy + 60, FLOOR_L);
  pic.blit(layer, ox + 8, oy + 12 - lift);
}
// Sequência da prévia: pular e cumprimentar tocam uma vez e seguram o último quadro um pouco antes de repetir.
const JUMP_LIFT = [0, 5, 10, 13, 12, 7, 0, 0];
function previewSeq(name) {
  const a = ANIM[name];
  if (name === 'jump') return { fps: 14, steps: Array.from({ length: 14 }, (_, i) => ({ f: Math.min(i, 7), lift: JUMP_LIFT[Math.min(i, 7)] })) };
  if (name === 'tiphat') return { fps: 8, steps: Array.from({ length: 16 }, (_, i) => ({ f: Math.min(i, 11), lift: 0 })) };
  return { fps: a.fps, steps: a.frames.map((_, f) => ({ f, lift: 0 })) };
}

/* ---------- Saída ---------- */
/* ---------- Expressões para ocasiões (de frente, para a cara aparecer inteira) ---------- */
{ // feliz: tarefa concluída. Pulinhos, braços para cima, olhos de estrela e brilhos
  const BY = [0, -2, -3, -2, 0, 1, 0, 0];
  ANIM.happy = { nome: 'feliz', fps: 10, loop: true, frames: BY.map((by, i) => ({
    view: 'front', by, ...(by > 0 ? { rx: 1, ry: -1 } : {}), feet: [[0, Math.min(0, by)], [0, Math.min(0, by)]],
    eyes: i % 4 < 2 ? 'star' : 'happy', mouth: 'grin', hands: [[-11, by < 0 ? -9 : -4], [11, by < 0 ? -9 : -4]], hat: { dy: lag(BY, i) },
    fx: [FX.spark(...[[8, 18], [40, 14], [10, 10], [38, 22]][i % 4]), FX.spark(...[[40, 20], [9, 14], [39, 10], [8, 22]][i % 4])],
  })) };
}
{ // triste: deu erro. Murcho, sobrancelhas caídas, lágrima escorrendo
  const K = [0, 0, 1, 1, 1, 1, 0, 0];
  ANIM.sad = { nome: 'triste', fps: 6, loop: true, frames: K.map((k, i) => ({
    view: 'front', ...sq(1 + k), eyes: 'sad', brows: 'sad', mouth: 'frown', look: [0, 1], hands: [[-10, 7], [10, 7]], hat: { dy: 1, rot: -4 },
    fx: [FX.tear(19, 36 + i)],
  })) };
}
{ // bravo: treme, sobrancelhas franzidas, marca de raiva pulsando
  const BX = [-1, 1, -1, 1, 0, 1, -1, 0];
  ANIM.angry = { nome: 'bravo', fps: 12, loop: true, frames: BX.map((bx, i) => ({
    view: 'front', bx, eyes: 'squint', brows: 'angry', mouth: 'frown', hands: [[-11, 2 + (i % 2)], [11, 2 + ((i + 1) % 2)]], hat: { dy: i % 2 ? -1 : 0 },
    fx: [FX.anger(35, 20, i % 4 < 2)],
  })) };
}
// surpreso: arregala, a cartola salta, "!"
ANIM.surprised = { nome: 'surpreso', fps: 8, loop: true, frames: [
  { view: 'front' },
  { view: 'front', ...sq(1), eyes: 'squint' },
  { view: 'front', by: -1, eyes: 'wide', mouth: 'o', hands: [[-11, -6], [11, -6]], hat: { dy: -5, rot: -6 }, fx: [FX.mark('!', 37, 14)] },
  { view: 'front', by: -1, eyes: 'wide', mouth: 'o', hands: [[-11, -6], [11, -6]], hat: { dy: -4, rot: -3 }, fx: [FX.mark('!', 37, 13)] },
  { view: 'front', eyes: 'wide', mouth: 'o', hands: [[-11, -3], [11, -3]], hat: { dy: -1 }, fx: [FX.mark('!', 37, 13)] },
  { view: 'front', eyes: 'wide', mouth: 'o', hat: { dy: 0 } },
  { view: 'front', eyes: 'blink' },
  { view: 'front' },
] };
{ // confuso: inclina a cabeça de um lado para o outro, "?" balançando
  const LEAN = [0, -3, -5, -5, -3, 0, 0, 0];
  ANIM.confused = { nome: 'confuso', fps: 6, loop: true, frames: LEAN.map((lean, i) => ({
    view: 'front', lean, eyes: ['squint', 'open'], brows: 'up', mouth: 'wavy', hands: [[-10, 5], [9, -2]],
    fx: [FX.mark('?', 36, 14 - (i % 2))],
  })) };
}
// apaixonado: olhos de coração, corações subindo
ANIM.love = { nome: 'apaixonado', fps: 8, loop: true, frames: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({
  view: 'front', ...sq(i % 4 < 2 ? 0 : 1), eyes: 'heart', mouth: 'smile', hands: [[-8, 3], [8, 3]],
  fx: [FX.heart(34 + (i > 3 ? 1 : 0), 26 - i * 2), FX.heart(8 - (((i + 4) % 8) > 3 ? 1 : 0), 26 - ((i + 4) % 8) * 2)],
})) };
{ // tonto: olhos em X, balança, estrelinhas girando em volta da cartola
  const SW = [6, 4, 0, -4, -6, -4, 0, 4];
  ANIM.dizzy = { nome: 'tonto', fps: 10, loop: true, frames: SW.map((s, i) => ({
    view: 'front', lean: s, eyes: 'x', mouth: 'wavy', hands: [[-11, 4 - (i % 2) * 2], [11, 2 + (i % 2) * 2]], hat: { rot: s * 1.5 },
    fx: [0, 1, 2].map(k => { const a = (i / 8 + k / 3) * 2 * Math.PI; return FX.spark(24 + Math.cos(a) * 13, 15 + Math.sin(a) * 3); }),
  })) };
}

const ORDER = ['idle', 'walk', 'run', 'jump', 'think', 'notebook', 'wave', 'tiphat', 'drag', 'sleep', 'happy', 'sad', 'angry', 'surprised', 'confused', 'love', 'dizzy'];
for (const d of ['sprites', 'folhas', 'previa']) { rmSync(path.join(DIR, d), { recursive: true, force: true }); mkdirSync(path.join(DIR, d), { recursive: true }); }
const LAYERS = {};
for (const name of ORDER) {
  const frames = LAYERS[name] = ANIM[name].frames.map(render);
  frames.forEach((l, i) => writeFileSync(path.join(DIR, 'sprites', `${name}_${String(i + 1).padStart(2, '0')}.png`), png(W, H, (x, y) => l.get(x, y))));
  writeFileSync(path.join(DIR, 'folhas', `${name}.png`), png(W * frames.length, H, (x, y) => frames[(x / W) | 0].get(x % W, y)));
  const { fps, steps } = previewSeq(name), S = 4;
  const pics = steps.map(({ f, lift }) => { const p = new Pic(STAGE_W, STAGE_H); stage(p, 0, 0, frames[f], lift); return p.scaled(S); });
  writeFileSync(path.join(DIR, 'previa', `${name}.gif`), gif(STAGE_W * S, STAGE_H * S, pics, steps.map(() => Math.round(100 / fps))));
}

// Vitrine: todas juntas, 5 por linha, com o nome; 4 s a 25 quadros/s (todas fecham o ciclo nesse tempo)
{
  const COLS = 5, CELL_H = STAGE_H + 10, S = 3, rows = Math.ceil(ORDER.length / COLS), pics = [];
  const seqs = Object.fromEntries(ORDER.map(n => [n, previewSeq(n)]));
  for (let t = 0; t < 100; t++) {
    const pic = new Pic(COLS * STAGE_W + COLS - 1, rows * CELL_H + rows - 1);
    pic.fill(0, 0, pic.w - 1, pic.h - 1, FLOOR_L);
    ORDER.forEach((name, k) => {
      const ox = (k % COLS) * (STAGE_W + 1), oy = ((k / COLS) | 0) * (CELL_H + 1), { fps, steps } = seqs[name];
      const st = steps[Math.floor(t * 0.04 * fps + 1e-6) % steps.length];
      pic.fill(ox, oy, ox + STAGE_W - 1, oy + CELL_H - 1, BG);
      pic.text(ANIM[name].nome.toUpperCase(), ox + STAGE_W / 2, oy + 3, LABEL);
      stage(pic, ox, oy + 10, LAYERS[name][st.f], st.lift);
    });
    pics.push(pic.scaled(S));
  }
  writeFileSync(path.join(DIR, 'previa', 'vitrine.gif'), gif((COLS * STAGE_W + COLS - 1) * S, (rows * CELL_H + rows - 1) * S, pics, pics.map(() => 4)));
}

writeFileSync(path.join(DIR, 'animacoes.json'), JSON.stringify({
  w: W, h: H,
  anims: Object.fromEntries(ORDER.map(n => [n, { n: ANIM[n].frames.length, fps: ANIM[n].fps, loop: ANIM[n].loop, nome: ANIM[n].nome }])),
}, null, 2) + '\n');
console.log(`Pronto: ${ORDER.reduce((a, n) => a + ANIM[n].frames.length, 0)} quadros em ${ORDER.length} animações → ${path.relative(process.cwd(), DIR) || '.'}`);
