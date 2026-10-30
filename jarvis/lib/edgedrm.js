// SPDX-License-Identifier: LGPL-3.0-or-later
// Token Sec-MS-GEC v2 da voz neural gratuita da Microsoft (a "Leitura em voz alta" do Edge).
// Reimplementação em JavaScript do algoritmo do projeto edge-tts (https://github.com/rany2/edge-tts,
// src/edge_tts/drm.py), que é LGPLv3. Este arquivo, e só ele, fica sob a mesma licença (LGPL-3.0-or-later);
// o resto do Jarvis não muda de licença. O texto da licença: https://www.gnu.org/licenses/lgpl-3.0.html
//
// O token é "<16 hex>-<64 hex>": um checksum de 64 bits (CS64) e um SHA-256 de um prefixo fixo de 57 bytes
// mais "<ticks do Windows arredondados a 5 min><TrustedClientToken>". O estado do SHA-256 depois do prefixo
// vem pré-calculado (as tabelas abaixo), por isso a conta começa "no meio" do primeiro bloco.

const SHA_INITIAL = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
const SHA_STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2];
const SHA_SCHEDULE = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E,
  0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564];
const K = [0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3,
  0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13,
  0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208,
  0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2];
const SHA_ADJUSTMENT = 0xC9DC06A7;
const K_BLOCK = [...K.slice(0, 14), SHA_ADJUSTMENT, ...K.slice(15)];
const SIGMA0_ADJ = 0x059C0B80, SIGMA1_ADJ = 0x000B92C0;
const CS64_COEF = [[0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF], [0x8D1EC211, 0xD405B4D5],
  [0x314EF5D5, 0x26E55F3C], [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB], [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464],
  [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61], [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167]];
const CS64_FACTOR = 0x82893933, CS64_ADJ0 = 0xF2F90B1A, CS64_ADJ1 = 0x0B1A0000;

const u = x => x >>> 0;
const add = (...v) => v.reduce((s, x) => (s + x) >>> 0, 0);
const mul = (a, b) => Math.imul(a, b) >>> 0;
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
const rol16 = x => ((x << 16) | (x >>> 16)) >>> 0;
const sigma0 = x => u(rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3));
const sigma1 = x => u(rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10));

// Rodadas do SHA-256 a partir de "first" (14 = retomando no meio do primeiro bloco, com a constante ajustada).
function rounds(state, w, first = 0) {
  const k = first === 14 ? K_BLOCK : K;
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = first; i < 64; i++) {
    const t1 = add(h, u(rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)), u(g ^ (e & (f ^ g))), k[i], w[i]);
    const t2 = add(u(rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)), u((a & b) | (c & (a | b))));
    h = g; g = f; f = e; e = add(d, t1); d = c; c = b; b = a; a = add(t1, t2);
  }
  return [a, b, c, d, e, f, g, h];
}
function expand(w, from = 16) {
  for (let i = from; i < 64; i++) w[i] = add(sigma1(w[i - 2]), w[i - 7], sigma0(w[i - 15]), w[i - 16]);
}
// Estado inicial: as tabelas pré-calculadas + os 7 primeiros bytes do texto (que fecham o primeiro bloco).
function shaInit(data) {
  const w = new Array(14).fill(0);
  w.push(data.readUIntBE(0, 3), data.readUInt32BE(3));
  for (let i = 16; i < 30; i++) {
    let v = SHA_SCHEDULE[i - 16];
    if (i - 2 >= 14) v = add(v, i === 16 ? u(sigma1(w[i - 2]) ^ SIGMA1_ADJ) : sigma1(w[i - 2]));
    if (i - 7 >= 14) v = add(v, w[i - 7]);
    if (i - 15 >= 14) v = add(v, i === 29 ? u(sigma0(w[i - 15]) ^ SIGMA0_ADJ) : sigma0(w[i - 15]));
    w.push(v);
  }
  w.push(u(add(sigma1(w[28]), w[23], sigma0(w[15]), w[14], SHA_ADJUSTMENT) - K[14]));
  expand(w, 31);
  const work = rounds(SHA_STATE, w, 14);
  return SHA_INITIAL.map((x, i) => add(x, work[i]));
}
export function sha256Token(data) {
  if (data.length < 7) throw new Error('Token curto demais.');
  const length = 57 + data.length;
  const zeros = (((55 - length) % 64) + 64) % 64;
  const tail = Buffer.alloc(8); tail.writeBigUInt64BE(BigInt(length * 8));
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(zeros), tail]);
  let state = shaInit(data);
  for (let off = 0; off < padded.length; off += 64) {
    const w = []; for (let i = 0; i < 16; i++) w.push(padded.readUInt32BE(off + i * 4));
    expand(w);
    const work = rounds(state, w);
    state = state.map((x, i) => add(x, work[i]));
  }
  const out = Buffer.alloc(32); state.forEach((x, i) => out.writeUInt32BE(x, i * 4));
  return out;
}
// Palavras de 32 bits little-endian, completando com zeros até um número par.
function wordsLe(data) {
  const pad = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const w = []; for (let i = 0; i < pad.length; i += 4) w.push(pad.readUInt32LE(i));
  if (w.length % 2) w.push(0);
  return w;
}
export function cs64(data, digest) {
  const keyA = u(digest.readUInt32LE(0) | 1), keyB = u(digest.readUInt32LE(4) | 1);
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)];
  const terms = CS64_COEF.map(([c], i) => mul(c, factors[i % 2]));
  const offsets = CS64_COEF.map(([, o]) => o);
  wordsLe(Buffer.concat([Buffer.from([0]), data])).forEach((word, i) => {
    let term = mul(word, i % 2 === 0 ? keyA : keyB), off = mul(rol16(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB);
    if (i === 0) { term = add(term, mul(CS64_ADJ0, factors[0])); off = add(off, CS64_ADJ1); }
    terms.push(term); offsets.push(off);
  });
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = rol16(add(offsets[i], x)), q = mul(t, 0x76F50F34);
    swapAcc = add(swapAcc, add(mul(rol16(q), 0xC3EFEA97), q));
    t = rol16(add(offsets[i + 1], y)); q = mul(t, 0x1881CE3C);
    swapLast = add(mul(rol16(q), 0x35BD1EC9), q);
    swapAcc = add(swapAcc, swapLast);
    state = add(mul(state, keyA), x);
    state = mul(rol16(state), 0xCF98B111); state = mul(rol16(state), 0x87085B9F);
    state = mul(rol16(state), 0x12CEB96D); state = mul(rol16(state), 0x257E1D83);
    acc = add(acc, state);
    t = add(mul(state, keyB), y);
    t = mul(rol16(t), 0xA27416F5); t = mul(rol16(t), 0xD38396FF);
    state = mul(rol16(mul(rol16(t), 0x7C932B89)), 0xBFA49F69);
    acc = add(acc, state);
  }
  return [u(swapLast ^ state), u(swapAcc ^ acc)];
}
// Token completo para um instante (ms desde 1970, já com o ajuste de relógio).
export function secGecV2(nowMs, token) {
  let t = Math.floor(nowMs / 1000) + 11644473600;
  t -= t % 300;
  const data = Buffer.from(`${BigInt(t) * 10_000_000n}${token}`, 'ascii');
  const digest = sha256Token(data), [w0, w1] = cs64(data, digest);
  const c = Buffer.alloc(8); c.writeUInt32LE(w0, 0); c.writeUInt32LE(w1, 4);
  return `${c.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`;
}
