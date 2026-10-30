// Quadros do Jarvis Code: animações por nome (parado, andar, correr, pular, pensar, digitar, acenar, cumprimentar,
// arrastado, dormir), cada uma com <nome>_NN.png e <nome>.txt ("NN ms" por linha: quanto tempo cada quadro fica).
// Os quadros saem de sprites\fonte\vitrine.gif (tools\GifSprites.exe) e têm o mesmo tamanho e o mesmo chão:
// o ponto de apoio (pés) é fixo, lido de ancora.txt ("x y"). No pulo, o apoio segue os pés (quem sobe é o próprio pulo).
// Gera bitmaps já escalados (inteiro, vizinho mais próximo) e espelhados, prontos para a janela em camadas.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

namespace JarvisDesktop
{
    class Frame
    {
        public Bitmap Bmp; public int W, H;
        public int AnchorX, AnchorY;   // pés: centro da base (x) e linha logo abaixo do último pixel (y)
        public int BodyTop;            // primeira linha do corpo, ignorando o balão (usado para saber a altura útil)
    }

    class Anim
    {
        public string Name; public Frame[] Frames; public double[] Ends;   // Ends[i] = fim do quadro i, em segundos
        public double Length { get { return Ends[Ends.Length - 1]; } }
        // Quadro no instante t: em laço, ou parado no último (once).
        public int At(double t, bool once = false)
        {
            if (once && t >= Length) return Frames.Length - 1;
            t = t % Length; if (t < 0) t = 0;
            for (int i = 0; i < Ends.Length; i++) if (t < Ends[i]) return i;
            return Frames.Length - 1;
        }
    }

    class SpriteSet
    {
        public static readonly string[] Names = { "parado", "andar", "correr", "pular", "pensar", "digitar", "acenar", "cumprimentar", "arrastado", "dormir" };
        // Expressões (opcionais: sem o arquivo, o Jarvis Code só não faz a cara).
        public static readonly string[] Moods = { "feliz", "triste", "bravo", "surpreso", "confuso", "apaixonado", "tonto" };
        public bool Has(string name) { return name != null && anims.ContainsKey(name); }
        readonly Dictionary<string, Anim> anims = new Dictionary<string, Anim>();
        public Anim this[string name] { get { return anims[name]; } }

        public static SpriteSet Load(string dir)
        {
            var s = new SpriteSet();
            int ax = -1, ay = -1; string af = Path.Combine(dir, "ancora.txt");
            if (File.Exists(af)) { var p = File.ReadAllText(af).Split(new[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries); if (p.Length == 2) { int.TryParse(p[0], out ax); int.TryParse(p[1], out ay); } }
            foreach (var name in Names.Concat(Moods))
            {
                var frames = new List<Frame>(); var ends = new List<double>(); double t = 0;
                string tf = Path.Combine(dir, name + ".txt");
                if (!File.Exists(tf) && Moods.Contains(name)) continue;
                if (!File.Exists(tf)) throw new FileNotFoundException("Animação não encontrada: " + tf + " (rode o build.cmd)");
                foreach (var line in File.ReadAllLines(tf))
                {
                    var p = line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries); int n, ms;
                    if (p.Length != 2 || !int.TryParse(p[0], out n) || !int.TryParse(p[1], out ms) || ms <= 0) continue;
                    var f = LoadFrame(Path.Combine(dir, string.Format("{0}_{1:00}.png", name, n)));
                    if (ax >= 0) { f.AnchorX = ax; if (name != "pular") f.AnchorY = ay; }
                    frames.Add(f); t += ms / 1000.0; ends.Add(t);
                }
                if (frames.Count == 0) throw new InvalidDataException("Animação vazia: " + tf);
                s.anims[name] = new Anim { Name = name, Frames = frames.ToArray(), Ends = ends.ToArray() };
            }
            return s;
        }

        static Frame LoadFrame(string file)
        {
            if (!File.Exists(file)) throw new FileNotFoundException("Sprite não encontrado: " + file);
            Bitmap bmp;
            using (var ms = new MemoryStream(File.ReadAllBytes(file)))   // copia para não travar o arquivo
            using (var img = Image.FromStream(ms))
            {
                bmp = new Bitmap(img.Width, img.Height, PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(bmp)) { g.CompositingMode = CompositingMode.SourceCopy; g.DrawImage(img, 0, 0, img.Width, img.Height); }
            }
            var f = new Frame { Bmp = bmp, W = bmp.Width, H = bmp.Height };
            var data = bmp.LockBits(new Rectangle(0, 0, f.W, f.H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var px = new byte[data.Stride * f.H]; Marshal.Copy(data.Scan0, px, 0, px.Length); bmp.UnlockBits(data);
            Func<int, int, bool> on = (x, y) => px[y * data.Stride + x * 4 + 3] > 40;
            int bottom = -1;
            for (int y = f.H - 1; y >= 0 && bottom < 0; y--) for (int x = 0; x < f.W; x++) if (on(x, y)) { bottom = y; break; }
            if (bottom < 0) { f.AnchorX = f.W / 2; f.AnchorY = f.H; f.BodyTop = 0; return f; }
            // Faixa dos pés: as últimas linhas (1/8 da altura). Os frames têm tamanhos diferentes; alinhar por aqui
            // mantém o boneco no mesmo lugar mesmo com balão de pensamento ou pernas abertas.
            int band = Math.Max(1, f.H / 8), minX = f.W, maxX = -1;
            for (int y = Math.Max(0, bottom - band + 1); y <= bottom; y++) for (int x = 0; x < f.W; x++) if (on(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
            f.AnchorX = (minX + maxX + 1) / 2; f.AnchorY = bottom + 1;
            // Topo do corpo: subindo a partir dos pés pela coluna do centro até achar uma linha toda vazia nessa região.
            int top = bottom;
            for (int y = bottom; y >= 0; y--)
            {
                bool any = false;
                for (int x = Math.Max(0, minX - band); x <= Math.Min(f.W - 1, maxX + band); x++) if (on(x, y)) { any = true; break; }
                if (!any) break; top = y;
            }
            f.BodyTop = top;
            return f;
        }
    }

    // Cache de bitmaps prontos (HBITMAP pré-multiplicado) por quadro/escala/espelho.
    class Renderer : IDisposable
    {
        public class Img { public IntPtr HBmp; public int W, H, AX, AY, BodyH; }
        readonly Dictionary<string, Img> cache = new Dictionary<string, Img>();

        public Img Get(string key, Frame f, int scale, bool mirror)
        {
            string k = key + "|" + scale + "|" + (mirror ? "m" : "n");
            Img img;
            if (cache.TryGetValue(k, out img)) return img;
            int w = f.W * scale, h = f.H * scale;
            using (var dst = new Bitmap(w, h, PixelFormat.Format32bppPArgb))
            {
                using (var g = Graphics.FromImage(dst))
                {
                    g.Clear(Color.Transparent);
                    g.InterpolationMode = InterpolationMode.NearestNeighbor;   // pixel-perfect
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.CompositingMode = CompositingMode.SourceCopy;
                    if (mirror) { g.TranslateTransform(w, 0); g.ScaleTransform(-1, 1); }
                    using (var ia = new ImageAttributes())
                    {
                        ia.SetWrapMode(WrapMode.TileFlipXY);                      // evita "sangrar" a borda ao escalar
                        g.DrawImage(f.Bmp, new Rectangle(0, 0, w, h), 0, 0, f.W, f.H, GraphicsUnit.Pixel, ia);
                    }
                }
                // Copia os bytes já pré-multiplicados (PArgb) para uma DIB de 32 bits, formato que o UpdateLayeredWindow exige.
                var data = dst.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
                var bi = new W.BITMAPINFOHEADER { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
                IntPtr bits; IntPtr hbmp = W.CreateDIBSection(IntPtr.Zero, ref bi, 0, out bits, IntPtr.Zero, 0);
                var row = new byte[w * 4];
                for (int y = 0; y < h; y++) { Marshal.Copy(data.Scan0 + y * data.Stride, row, 0, row.Length); Marshal.Copy(row, 0, bits + y * w * 4, row.Length); }
                dst.UnlockBits(data);
                img = new Img { HBmp = hbmp, W = w, H = h, AX = (mirror ? f.W - f.AnchorX : f.AnchorX) * scale, AY = f.AnchorY * scale, BodyH = (f.AnchorY - f.BodyTop) * scale };
            }
            cache[k] = img;
            return img;
        }

        public void Dispose() { foreach (var i in cache.Values) W.DeleteObject(i.HBmp); cache.Clear(); }
    }
}
