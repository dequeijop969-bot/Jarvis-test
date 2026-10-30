// Recorta as folhas de sprites (andar/pular e pensar) em quadros PNG individuais, no tamanho REAL da pixel art.
// Passos: acha cada boneco na folha -> estima o tamanho do "pixel da arte" -> amostra a grade (maioria por célula)
// -> fundo branco externo vira transparente (o branco dos olhos, da cartola e do balão continua branco).
// Uso: SpriteCutter.exe <andar-pular.(webp|png)> <pensar.png> <pasta-saida>
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

class Img { public int W, H; public byte[] Px; }
class Box { public int X0 = int.MaxValue, Y0 = int.MaxValue, X1 = -1, Y1 = -1, N;
  public int W { get { return X1 - X0 + 1; } } public int H { get { return Y1 - Y0 + 1; } }
  public void Add(int x, int y) { if (x < X0) X0 = x; if (y < Y0) Y0 = y; if (x > X1) X1 = x; if (y > Y1) Y1 = y; N++; } }

static class SpriteCutter {
  static Img Load(string path) {
    var d = BitmapDecoder.Create(new Uri(Path.GetFullPath(path)), BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
    var f = new FormatConvertedBitmap(d.Frames[0], PixelFormats.Bgra32, null, 0);
    var im = new Img { W = f.PixelWidth, H = f.PixelHeight };
    im.Px = new byte[im.W * im.H * 4]; f.CopyPixels(im.Px, im.W * 4, 0);
    return im;
  }
  // Escuro = parte do boneco (preto). Limiar no meio porque o .webp tem borrões de compressão.
  static bool[] Dark(Img im) {
    var m = new bool[im.W * im.H];
    for (int i = 0; i < m.Length; i++) {
      int b = im.Px[i * 4], g = im.Px[i * 4 + 1], r = im.Px[i * 4 + 2], a = im.Px[i * 4 + 3];
      m[i] = a > 128 && (r * 299 + g * 587 + b * 114) / 1000 < 128;
    }
    return m;
  }
  // Dilatação separável (junta cartola, corpo e pés num componente só).
  static bool[] Dilate(bool[] m, int w, int h, int r) {
    var t = new bool[m.Length]; var o = new bool[m.Length];
    for (int y = 0; y < h; y++) { int last = -100000; for (int x = 0; x < w; x++) if (m[y * w + x]) last = x; else if (x - last <= r) t[y * w + x] = true;
      last = 100000; for (int x = w - 1; x >= 0; x--) if (m[y * w + x]) { last = x; t[y * w + x] = true; } else if (last - x <= r) t[y * w + x] = true; }
    for (int x = 0; x < w; x++) { int last = -100000; for (int y = 0; y < h; y++) if (t[y * w + x]) { last = y; o[y * w + x] = true; } else if (y - last <= r) o[y * w + x] = true;
      last = 100000; for (int y = h - 1; y >= 0; y--) if (t[y * w + x]) last = y; else if (last - y <= r) o[y * w + x] = true; }
    return o;
  }
  static List<Box> Components(bool[] dil, bool[] dark, int w, int h) {
    var lab = new int[dil.Length]; var boxes = new List<Box>(); var st = new Stack<int>();
    for (int i = 0; i < dil.Length; i++) {
      if (!dil[i] || lab[i] != 0) continue;
      var b = new Box(); boxes.Add(b); int id = boxes.Count; lab[i] = id; st.Push(i);
      while (st.Count > 0) {
        int p = st.Pop(), x = p % w, y = p / w; if (dark[p]) b.Add(x, y);
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
          int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          int q = ny * w + nx; if (dil[q] && lab[q] == 0) { lab[q] = id; st.Push(q); } }
      }
    }
    return boxes.Where(b => b.N > 0).ToList();
  }
  // Amostra a grade: célula escura se >= limiar de cobertura escura.
  static int[,] Sample(bool[] dark, int w, Box b, double c, double ox, double oy, double thr, out double err) {
    int cols = (int)Math.Ceiling((b.W + ox) / c), rows = (int)Math.Ceiling((b.H + oy) / c);
    var g = new int[rows, cols]; long bad = 0, tot = 0;
    for (int r = 0; r < rows; r++) for (int k = 0; k < cols; k++) {
      int x0 = (int)Math.Round(b.X0 - ox + k * c), x1 = (int)Math.Round(b.X0 - ox + (k + 1) * c), y0 = (int)Math.Round(b.Y0 - oy + r * c), y1 = (int)Math.Round(b.Y0 - oy + (r + 1) * c);
      int n = 0, d = 0;
      for (int y = Math.Max(y0, b.Y0); y < Math.Min(y1, b.Y1 + 1); y++) for (int x = Math.Max(x0, b.X0); x < Math.Min(x1, b.X1 + 1); x++) { n++; if (dark[y * w + x]) d++; }
      bool on = n > 0 && d >= n * thr; g[r, k] = on ? 1 : 0; bad += on ? n - d : d; tot += n;
    }
    err = tot > 0 ? (double)bad / tot : 1; return g;
  }
  // Tamanho do pixel da arte: o MAIOR tamanho cujo erro de reconstrução ainda fica perto do mínimo
  // (tamanhos menores sempre "acertam" mais; o tamanho certo é o maior que ainda acerta quase tudo).
  static double EstimateCell(bool[] dark, int w, List<Box> sample) {
    var errs = new SortedDictionary<double, double>();
    for (double c = 4; c <= 18; c += 0.25) {
      double sum = 0;
      foreach (var b in sample) { double best = 1; for (double o = 0; o < c; o += Math.Max(1, c / 6)) for (double o2 = 0; o2 < c; o2 += Math.Max(1, c / 6)) { double e; Sample(dark, w, b, c, o, o2, 0.5, out e); if (e < best) best = e; } sum += best; }
      errs[c] = sum / sample.Count;
    }
    double min = errs.Values.Min(), pick = 4;
    foreach (var kv in errs) if (kv.Value <= min * 1.35 + 0.004) pick = kv.Key;
    Console.WriteLine("  erro mínimo {0:0.0000}; célula escolhida {1:0.00} px", min, pick);
    return pick;
  }
  static void Save(int[,] g, string file, int scale) {
    int rows = g.GetLength(0) + 2, cols = g.GetLength(1) + 2;   // 1 célula de margem transparente
    var v = new int[rows, cols];                                // 0 claro, 1 escuro, 2 fundo
    for (int r = 0; r < rows; r++) for (int k = 0; k < cols; k++) v[r, k] = (r == 0 || k == 0 || r == rows - 1 || k == cols - 1) ? 0 : g[r - 1, k - 1];
    var st = new Stack<int[]>(); st.Push(new[] { 0, 0 });       // fundo = claro ligado à borda (4 vizinhos)
    while (st.Count > 0) { var p = st.Pop(); int r = p[0], k = p[1]; if (r < 0 || k < 0 || r >= rows || k >= cols || v[r, k] != 0) continue; v[r, k] = 2;
      st.Push(new[] { r + 1, k }); st.Push(new[] { r - 1, k }); st.Push(new[] { r, k + 1 }); st.Push(new[] { r, k - 1 }); }
    int W = cols * scale, H = rows * scale; var px = new byte[W * H * 4];
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) { int s = v[y / scale, x / scale], i = (y * W + x) * 4;
      if (s == 2) continue; byte c = (byte)(s == 1 ? 0 : 255); px[i] = c; px[i + 1] = c; px[i + 2] = c; px[i + 3] = 255; }
    var bmp = BitmapSource.Create(W, H, 96, 96, PixelFormats.Bgra32, null, px, W * 4);
    var enc = new PngBitmapEncoder(); enc.Frames.Add(BitmapFrame.Create(bmp));
    using (var fs = File.Create(file)) enc.Save(fs);
  }
  // Ícone .ico (uma imagem PNG 64x64 dentro, formato aceito desde o Windows Vista), em escala inteira.
  static void Ico(int[,] g, string file) {
    string tmp = Path.GetTempFileName(); Save(g, tmp, 1);
    var src = BitmapDecoder.Create(new Uri(tmp), BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0];
    int s = Math.Max(1, 64 / Math.Max(src.PixelWidth, src.PixelHeight));
    var dv = new DrawingVisual(); RenderOptions.SetBitmapScalingMode(dv, BitmapScalingMode.NearestNeighbor);
    using (var dc = dv.RenderOpen()) dc.DrawImage(src, new Rect((64 - src.PixelWidth * s) / 2, (64 - src.PixelHeight * s) / 2, src.PixelWidth * s, src.PixelHeight * s));
    var rt = new RenderTargetBitmap(64, 64, 96, 96, PixelFormats.Pbgra32); rt.Render(dv);
    var enc = new PngBitmapEncoder(); enc.Frames.Add(BitmapFrame.Create(rt)); var ms = new MemoryStream(); enc.Save(ms); var png = ms.ToArray();
    using (var bw = new BinaryWriter(File.Create(file))) {
      bw.Write((short)0); bw.Write((short)1); bw.Write((short)1);                // ICONDIR: 1 imagem
      bw.Write((byte)64); bw.Write((byte)64); bw.Write((byte)0); bw.Write((byte)0); bw.Write((short)1); bw.Write((short)32);
      bw.Write(png.Length); bw.Write(6 + 16); bw.Write(png);
    }
    File.Delete(tmp);
  }
  static int[,] Best(bool[] dark, int w, Box b, double c) {
    int[,] best = null; double be = 2;
    for (double o = 0; o < c; o += 1) for (double o2 = 0; o2 < c; o2 += 1) { double e; var g = Sample(dark, w, b, c, o, o2, 0.45, out e); if (e < be) { be = e; best = g; } }
    return best;
  }

  [STAThread]
  static int Main(string[] a) {
    if (a.Length < 3) { Console.WriteLine("Uso: SpriteCutter <andar-pular> <pensar> <saida>"); return 1; }
    Directory.CreateDirectory(a[2]); Directory.CreateDirectory(Path.Combine(a[2], "previa"));
    // 1) Andar + pular: componentes; descarta rótulos (pequenos) e títulos (largos e baixos).
    var s1 = Load(a[0]); var d1 = Dark(s1);
    var all = Components(Dilate(d1, s1.W, s1.H, 6), d1, s1.W, s1.H);
    var sprites = all.Where(b => b.W > 90 && b.H > 90 && b.W < 300 && b.H < 300 && b.W < b.H * 1.6).ToList();
    Console.WriteLine("andar/pular: {0} componentes, {1} bonecos", all.Count, sprites.Count);
    var walk = sprites.Where(b => (b.Y0 + b.Y1) / 2 < s1.H / 2).OrderBy(b => b.X0).ToList();
    var jump = sprites.Where(b => (b.Y0 + b.Y1) / 2 >= s1.H / 2).OrderBy(b => b.X0).ToList();
    if (walk.Count != 8 || jump.Count != 8) { Console.WriteLine("Esperava 8+8 quadros, achei {0}+{1}.", walk.Count, jump.Count); foreach (var b in sprites) Console.WriteLine("  {0},{1} {2}x{3}", b.X0, b.Y0, b.W, b.H); return 2; }
    double c1 = EstimateCell(d1, s1.W, walk.Take(3).ToList());
    for (int i = 0; i < 8; i++) { Save(Best(d1, s1.W, walk[i], c1), Path.Combine(a[2], string.Format("walk_{0:00}.png", i + 1)), 1); Save(Best(d1, s1.W, walk[i], c1), Path.Combine(a[2], "previa", string.Format("walk_{0:00}.png", i + 1)), 8); }
    for (int i = 0; i < 8; i++) { Save(Best(d1, s1.W, jump[i], c1), Path.Combine(a[2], string.Format("jump_{0:00}.png", i + 1)), 1); Save(Best(d1, s1.W, jump[i], c1), Path.Combine(a[2], "previa", string.Format("jump_{0:00}.png", i + 1)), 8); }
    // 2) Pensar: grade 4x2 (cada célula tem boneco + balão; o balão fica no quadro).
    var s2 = Load(a[1]); var d2 = Dark(s2); var cells = new List<Box>();
    for (int r = 0; r < 2; r++) for (int k = 0; k < 4; k++) { var b = new Box();
      for (int y = r * s2.H / 2; y < (r + 1) * s2.H / 2; y++) for (int x = k * s2.W / 4; x < (k + 1) * s2.W / 4; x++) if (d2[y * s2.W + x]) b.Add(x, y);
      cells.Add(b); }
    // Mesma escala do andar: o corpo do quadro 1 (sem balão) deve ter a mesma largura do corpo andando.
    double walkW = walk.Select(b => (double)b.W).OrderBy(x => x).ElementAt(4);
    double c2 = c1 * cells[0].W / walkW;
    Console.WriteLine("  pensar: célula ajustada para {0:0.00} px (corpo {1}px / andar {2}px)", c2, cells[0].W, walkW);
    for (int i = 0; i < 8; i++) { var g = Best(d2, s2.W, cells[i], c2); Save(g, Path.Combine(a[2], string.Format("think_{0:00}.png", i + 1)), 1); Save(g, Path.Combine(a[2], "previa", string.Format("think_{0:00}.png", i + 1)), 8); }
    if (a.Length >= 4) { Ico(Best(d1, s1.W, walk[0], c1), a[3]); Console.WriteLine("ícone: " + a[3]); }
    Console.WriteLine("pronto: célula andar/pular {0:0.00}px, pensar {1:0.00}px", c1, c2);
    foreach (var b in walk.Concat(jump).Concat(cells)) Console.WriteLine("  quadro {0}x{1} -> ~{2}x{3}", b.W, b.H, Math.Round(b.W / (cells.Contains(b) ? c2 : c1)), Math.Round(b.H / (cells.Contains(b) ? c2 : c1)));
    return 0;
  }
}

