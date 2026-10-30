// "Modo V": ao ouvir "Jarvis", a parte de cima da tela escurece em formato de V e o Jarvis aparece DENTRO do escuro,
// sem caixa: no centro o círculo dele (com o estado) e a legenda; na asa esquerda os modos e os recursos; na asa
// direita o slide. A janela flutuante continua trabalhando escondida (ouve, pensa, fala) e manda para cá o que mostrar.
// Arquivos soltos no escuro vão para o Jarvis (junto com o próximo pedido). Um clique no escuro fecha o V.
// A janela é transparente por pixel e fica fora das fotos da tela (o Jarvis, ao olhar a tela, vê o que está embaixo).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace JarvisDesktop
{
    class VOverlay : Form
    {
        public static bool InPhotos;   // só para testes (--v-na-foto): deixa o V aparecer nas capturas de tela
        // A página do app aparece recortada no V, por cima deste escuro (Floating.ShowInV): aqui fica só o fundo, a borda
        // suave e o brilho. O desenho próprio (círculo, legenda, slide) só entra se a página demorar a aparecer.
        public bool PageMode; DateTime shownAt;
        const double Core_K = 0.8;   // até 80% da profundidade do V o escuro é total (é onde a página aparece)
        // Contorno da parte totalmente escura do V (onde a página do app é mostrada), em pixels da janela w×h.
        public static Point[] Core(int w, int h)
        {
            var pts = new List<Point> { new Point(0, 0), new Point(w, 0) };
            for (int x = w; x >= 0; x -= 6) pts.Add(new Point(x, (int)(Core_K * EdgeOf(x, w, h))));
            if (pts[pts.Count - 1].X != 0) pts.Add(new Point(0, (int)(Core_K * EdgeOf(0, w, h))));
            return pts.ToArray();
        }
        // Tamanho do V: 62% da altura da tela, laterais menos rasas (mais espaço para os slides).
        public const double HeightFrac = 0.62;
        static double EdgeOf(double x, int w, int h) { double u = Math.Abs(x - w / 2.0) / (w / 2.0); return h * (0.98 - 0.52 * Math.Pow(u, 0.9)); }
        public event Action<string[]> FilesDropped;   // caminhos dos arquivos soltos no escuro
        public event Action Dismissed;                // clique no escuro

        // O que mostrar (vem da página pelo servidor, evento "v").
        string state = "idle", stateTxt = "", you = "", modo = "talk", slideT = "", slideF = "";
        string[] words = new string[0], points = new string[0], files = new string[0];
        int wordOn = -1, slideI, slideN;
        // Fala com tempos (evento "fala"): palavras, início de cada uma, grupos da legenda e a hora (ms) em que o áudio começou.
        string[] fW; double[] fS; int[][] fG; double fT0;
        // Animação da legenda (como no app): cada palavra anda até o alvo (apagada / dita / atual) e o grupo novo entra suave.
        float[] wOp = new float[0], wLift = new float[0], wHot = new float[0]; DateTime groupAt, lastFrame = DateTime.Now; float level;
        List<KeyValuePair<string, bool>> res = new List<KeyValuePair<string, bool>>();
        bool dragOver;

        Bitmap bg, canvas; IntPtr dib, bits; int bw, bh, bx, by;
        byte alpha, target; bool drawnBare; readonly Timer frame; readonly DateTime t0 = DateTime.Now;
        static readonly Color Acc = Color.FromArgb(245, 176, 65), Text0 = Color.FromArgb(244, 241, 234), Mute = Color.FromArgb(165, 162, 155);

        public VOverlay()
        {
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
            TopMost = true; AutoScaleMode = AutoScaleMode.None; Text = "Jarvis V"; AllowDrop = true;
            HandleCreated += (s, e) => { if (!InPhotos) try { W.SetWindowDisplayAffinity(Handle, W.WDA_EXCLUDEFROMCAPTURE); } catch { } };   // fora das fotos da tela
            frame = new Timer { Interval = 33 };   // ~30 quadros por segundo enquanto aparece
            frame.Tick += (s, e) =>
            {
                if (alpha != target) { int step = target > alpha ? 40 : -30; alpha = (byte)Math.Max(0, Math.Min(255, step > 0 ? Math.Min(alpha + step, target) : Math.Max(alpha + step, target))); }
                if (PageMode && alpha == target && drawnBare) { if (alpha == 0) { frame.Stop(); Hide(); } return; }   // só o fundo, parado: nada a redesenhar
                var sw = System.Diagnostics.Stopwatch.StartNew(); Render(); msSum += sw.Elapsed.TotalMilliseconds;
                if (++nFrames == 90) { Log.Write("modo V: desenho " + (msSum / nFrames).ToString("0.0") + " ms por quadro"); }
                if (alpha == 0 && target == 0) { frame.Stop(); Hide(); }
            };
            DragEnter += (s, e) => { if (e.Data.GetDataPresent(DataFormats.FileDrop)) { e.Effect = DragDropEffects.Copy; dragOver = true; } };
            DragLeave += (s, e) => dragOver = false;
            DragDrop += (s, e) => { dragOver = false; var f = e.Data.GetData(DataFormats.FileDrop) as string[]; if (f != null && f.Length > 0 && FilesDropped != null) FilesDropped(f); };
            MouseUp += (s, e) => { if (Dismissed != null) Dismissed(); };
        }
        // Sem WS_EX_TRANSPARENT: o escuro recebe arquivos e o clique de fechar (fora do escuro o mouse passa normal).
        protected override CreateParams CreateParams { get { var cp = base.CreateParams; cp.ExStyle |= W.WS_EX_LAYERED | W.WS_EX_TOOLWINDOW | W.WS_EX_NOACTIVATE | W.WS_EX_TOPMOST; return cp; } }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override void WndProc(ref Message m) { if (m.Msg == W.WM_MOUSEACTIVATE) { m.Result = (IntPtr)W.MA_NOACTIVATE; return; } base.WndProc(ref m); }

        public void ShowV()
        {
            var sc = Screen.PrimaryScreen.Bounds;
            if (bg == null || bw != sc.Width) Build(sc.Width, (int)(sc.Height * HeightFrac), sc.Left, sc.Top);
            state = "listen"; stateTxt = "Ouvindo…"; you = ""; words = new string[0]; wordOn = -1; fW = null; slideT = ""; points = new string[0]; slideN = 0; files = new string[0];
            PageMode = false; drawnBare = false; shownAt = DateTime.Now;
            if (!Visible) { alpha = 0; Show(); }
            W.SetWindowPos(Handle, W.HWND_TOPMOST, 0, 0, 0, 0, W.SWP_NOMOVE | W.SWP_NOSIZE | W.SWP_NOACTIVATE);
            target = 255; frame.Start();
        }
        public void HideV() { if (!Visible) return; target = 0; frame.Start(); }

        // Evento "v" da página: atualiza só o pedaço que mudou.
        public void Feed(Dictionary<string, object> d)
        {
            if (d == null) return;
            string k = S(d, "k");
            if (k == "estado") { string m = S(d, "m"); if (m != state && (m == "listen" || m == "think")) { words = new string[0]; wordOn = -1; fW = null; } state = m; stateTxt = S(d, "txt"); }   // legenda antiga sai ao ouvir/pensar o próximo pedido
            else if (k == "legenda") { words = A(d, "w"); wordOn = I(d, "on"); fW = null; }
            else if (k == "fala")
            {
                fW = A(d, "w"); fS = A(d, "s").Select(x => { double v; return double.TryParse(x, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v) ? v : 0; }).ToArray();
                object g; fG = d.TryGetValue("g", out g) && g is object[] ? ((object[])g).Select(x => x is object[] ? ((object[])x).Select(n => Convert.ToInt32(n)).ToArray() : new int[0]).Where(x => x.Length > 0).ToArray() : new int[0][];
                double t; fT0 = double.TryParse(S(d, "t0"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out t) ? t : 0;
                if (fG.Length == 0) fG = new[] { Enumerable.Range(0, fW.Length).ToArray() };
            }
            else if (k == "palavra") wordOn = I(d, "on");
            else if (k == "voce") you = S(d, "t");
            else if (k == "slide") { slideT = S(d, "t"); points = A(d, "p"); slideF = S(d, "f"); slideI = I(d, "i"); slideN = I(d, "n"); }
            else if (k == "arquivos") files = A(d, "n");
            else if (k == "tudo")
            {
                modo = S(d, "modo") == "code" ? "code" : "talk";
                res = new List<KeyValuePair<string, bool>>();
                object r; if (d.TryGetValue("r", out r) && r is object[])
                    foreach (var o in (object[])r) { var x = o as Dictionary<string, object>; if (x != null) res.Add(new KeyValuePair<string, bool>(S(x, "n"), S(x, "on") == "True")); }
            }
        }
        public void AddFileName(string n) { files = files.Concat(new[] { n }).Distinct().Take(8).ToArray(); }

        // Teste: desenha o V com dados de exemplo sobre uma "tela" cinza e salva em PNG (para ver o resultado sem a tela real).
        public static void SnapshotTest(string png, string fase)
        {
            using (var v = new VOverlay())
            {
                var sc = Screen.PrimaryScreen.Bounds; v.Build(sc.Width, (int)(sc.Height * HeightFrac), 0, 0);
                v.state = fase == "pensando" ? "think" : fase == "ouvindo" ? "listen" : "speak"; v.you = "quais são meus compromissos amanhã?";
                v.words = "O senhor tem três compromissos amanhã. O primeiro".Split(' '); v.wordOn = 5;
                v.slideT = "Agenda de amanhã"; v.points = new[] { "09:00 · Reunião com a equipe de design", "14:30 · Dentista (Dr. Paulo)", "19:00 · Jantar com a família" }; v.slideI = 0; v.slideN = 3;
                v.files = new[] { "relatorio.pdf", "print-erro.png" };
                v.res = new List<KeyValuePair<string, bool>> { new KeyValuePair<string, bool>("Agenda", true), new KeyValuePair<string, bool>("E-mails", true), new KeyValuePair<string, bool>("GitHub", false), new KeyValuePair<string, bool>("Tela", true), new KeyValuePair<string, bool>("Pasta", true), new KeyValuePair<string, bool>("MCP", false) };
                v.Render(false); v.groupAt = DateTime.Now.AddSeconds(-1); v.lastFrame = DateTime.Now.AddSeconds(-1); for (int i = 0; i < 12; i++) { v.lastFrame = DateTime.Now.AddMilliseconds(-60); v.Render(false); }   // deixa a animação da legenda chegar ao fim
                using (var shot = new Bitmap(sc.Width, (int)(sc.Height * 0.62)))
                {
                    using (var g = Graphics.FromImage(shot))
                    {
                        using (var b = new LinearGradientBrush(new Rectangle(0, 0, shot.Width, shot.Height), Color.FromArgb(90, 120, 150), Color.FromArgb(200, 205, 210), 60f)) g.FillRectangle(b, 0, 0, shot.Width, shot.Height);
                        using (var b = new SolidBrush(Color.FromArgb(240, 250, 250, 250))) g.FillRectangle(b, shot.Width * 0.18f, shot.Height * 0.2f, shot.Width * 0.64f, shot.Height * 0.9f);   // "janela" atrás
                        g.DrawImageUnscaled(v.canvas, 0, 0);
                    }
                    shot.Save(png, ImageFormat.Png);
                }
            }
        }

        static string S(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : ""; }
        static int I(Dictionary<string, object> d, string k) { int n; return int.TryParse(S(d, k), out n) ? n : 0; }
        static string[] A(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v is object[] ? ((object[])v).Select(x => Convert.ToString(x, System.Globalization.CultureInfo.InvariantCulture)).ToArray() : new string[0]; }

        // Fundo: escuro forte no topo, sumindo para baixo; a borda de baixo é um V (fundo no meio, raso nas laterais),
        // com um brilho âmbar acompanhando a borda. Calculado uma vez por tamanho de tela.
        double Edge(double x) { return EdgeOf(x, bw, bh); }
        // Luz suave como o radial-gradient do app: cor no centro, sumindo até 70% do raio.
        static void Glow(ref double r, ref double g, ref double b, int i, int j, int w, int h, double cx, double cy, double rx, double ry, int R, int G, int B, double s)
        {
            double dx = (i - cx * w) / (rx * w), dy = (j - cy * h) / (ry * h), d = Math.Sqrt(dx * dx + dy * dy) / 0.7;
            if (d >= 1) return;
            double k = s * (1 - d);
            r += (R - r) * k; g += (G - g) * k; b += (B - b) * k;
        }
        void Build(int w, int h, int x, int y)
        {
            int dotP = Math.Max(12, (int)Math.Round(26 * Desktop.MonitorAt(0, 0).Scale)), dotS = Math.Max(2, (int)Math.Round(1.6 * Desktop.MonitorAt(0, 0).Scale));
            if (bg != null) bg.Dispose(); if (canvas != null) canvas.Dispose(); if (dib != IntPtr.Zero) W.DeleteObject(dib);
            bw = w; bh = h; bx = x; by = y;
            bg = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            var data = bg.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
            var row = new int[w];
            for (int j = 0; j < h; j++)
            {
                for (int i = 0; i < w; i++)
                {
                    double u = Math.Abs(i - w / 2.0) / (w / 2.0), edge = Edge(i), t = j / edge;
                    // Escuro total até 80% (sem emenda com a página, que tem a mesma cor) e sumindo suave até a borda do V.
                    double q = Math.Max(0, Math.Min(1, (t - Core_K) / (1 - Core_K))), depth = Math.Min(1, t / Core_K);
                    // Translúcido: por baixo da página, mais firme no topo (0,9) e mais transparente rumo à ponta (0,45) — a página
                    // fica 90% opaca, então a tela aparece um pouco mais perto da ponta. Fora da página, começa como ela (0,9) e some
                    // suave até a borda do V (sem emenda no contorno).
                    double edgeIn = Math.Max(0, Math.Min(1, (t - (Core_K - 0.06)) / 0.06)), inner = 0.9 - 0.45 * depth * depth;
                    inner += (0.9 - inner) * edgeIn * edgeIn * (3 - 2 * edgeIn);   // perto do contorno da página volta a 0,9: sem fresta clara na borda
                    double a = t >= 1 ? 0 : t <= Core_K ? inner : 0.9 * (1 - q * q * (3 - 2 * q));
                    double glow = Math.Exp(-Math.Pow((j - edge) / (5 + 7 * (1 - u)), 2)) * 0.55 * (1 - 0.6 * u);
                    double A = Math.Min(1, a + glow * (1 - a)), gr = A > 0 ? glow * (1 - a) / A : 0;
                    // Mesmo fundo da janela oficial: grafite com luzes suaves (âmbar no alto à esquerda, verde-água embaixo à
                    // direita, âmbar subindo da ponta) e a grade de pontinhos de 26 px, que some nas bordas.
                    double cr = 11, cg = 12, cb = 15;
                    Glow(ref cr, ref cg, ref cb, i, j, w, h, 0.12, -0.08, 0.60, 0.50, 242, 179, 61, 0.09);
                    Glow(ref cr, ref cg, ref cb, i, j, w, h, 1.00, 1.05, 0.50, 0.45, 95, 179, 161, 0.08);
                    Glow(ref cr, ref cg, ref cb, i, j, w, h, 0.50, 1.08, 0.55, 0.40, 242, 179, 61, 0.14);
                    if (i % dotP < dotS && j % dotP < dotS)
                    {
                        double mx = (i - w * 0.5) / (w * 1.2), my = (j - h * 0.4) / (h * 0.8), md = Math.Sqrt(mx * mx + my * my);
                        double m = md <= 0.1 ? 1 : md >= 0.75 ? 0 : 1 - (md - 0.1) / 0.65, k = 0.11 * m;
                        cr += (163 - cr) * k; cg += (160 - cg) * k; cb += (154 - cb) * k;
                    }
                    int R = (int)((cr * (1 - gr) + 245 * gr) * A), G = (int)((cg * (1 - gr) + 176 * gr) * A), B = (int)((cb * (1 - gr) + 65 * gr) * A);
                    row[i] = ((int)(A * 255) << 24) | (R << 16) | (G << 8) | B;
                }
                Marshal.Copy(row, 0, data.Scan0 + j * data.Stride, w);
            }
            bg.UnlockBits(data);
            // A tela de desenho é a própria memória que o UpdateLayeredWindow mostra: nada de copiar 4 MB a cada quadro.
            var bi = new W.BITMAPINFOHEADER { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
            dib = W.CreateDIBSection(IntPtr.Zero, ref bi, 0, out bits, IntPtr.Zero, 0);
            canvas = new Bitmap(w, h, w * 4, PixelFormat.Format32bppPArgb, bits);
        }

        void Render(bool present = true)
        {
            if (canvas == null) return;
            double H = Screen.PrimaryScreen.Bounds.Height, cx = bw / 2.0, t = (DateTime.Now - t0).TotalSeconds;
            using (var g = Graphics.FromImage(canvas))
            {
                g.CompositingMode = CompositingMode.SourceCopy; g.DrawImageUnscaled(bg, 0, 0); g.CompositingMode = CompositingMode.SourceOver;
                drawnBare = PageMode || (DateTime.Now - shownAt).TotalSeconds < 2.5;
                if (drawnBare) goto show;   // a página mostra tudo (ou está para aparecer)
                g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

                // ---- Centro: círculo do Jarvis (anel muda com o estado) ----
                float r = (float)(H * 0.03), oy = (float)(H * 0.092);
                using (var core = new SolidBrush(Color.FromArgb(230, 14, 15, 19))) g.FillEllipse(core, (float)cx - r, oy - r, 2 * r, 2 * r);
                if (state == "think")
                {
                    using (var p = new Pen(Acc, r * 0.16f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                        g.DrawArc(p, (float)cx - r, oy - r, 2 * r, 2 * r, (float)(t * 300 % 360), 110);
                    using (var p = new Pen(Color.FromArgb(60, Acc), r * 0.08f)) g.DrawEllipse(p, (float)cx - r, oy - r, 2 * r, 2 * r);
                }
                else
                {
                    // Falando: o anel segue o som que está saindo de verdade (medidor do Windows), suavizado.
                    float peak = state == "speak" ? AudioLevel.Peak() : 0;
                    level = peak > level ? level + (peak - level) * 0.6f : level * 0.86f;
                    bool live = state == "speak" && level > 0.01f;
                    if (live) using (var gl = new SolidBrush(Color.FromArgb((int)(40 + 90 * Math.Min(1, level * 1.6)), Acc))) { float rr = r * (0.55f + 0.35f * Math.Min(1, level * 1.6f)); g.FillEllipse(gl, (float)cx - rr, oy - rr, 2 * rr, 2 * rr); }
                    int n = 48;
                    for (int i = 0; i < n; i++)
                    {
                        double a = i * Math.PI * 2 / n;
                        double amp = live ? Math.Min(1.15, 0.12 + level * 1.5 * (0.55 + 0.45 * Math.Sin(t * 9 + i * 0.7)) * (0.7 + 0.3 * Math.Sin(t * 4.3 + i * 1.9)))
                                   : state == "speak" ? 0.35 + 0.65 * Math.Abs(Math.Sin(t * 7 + i * 0.9) * Math.Sin(t * 3.1 + i * 0.37))
                                   : state == "listen" ? 0.25 + 0.25 * (0.5 + 0.5 * Math.Sin(t * 3)) : 0.15;
                        float r1 = r * 1.18f, r2 = r * (1.18f + 0.55f * (float)amp);
                        int al = state == "idle" ? 70 : 150 + (int)(105 * amp);
                        using (var p = new Pen(Color.FromArgb(Math.Min(255, al), Acc), Math.Max(1.5f, r * 0.07f)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                            g.DrawLine(p, (float)(cx + Math.Cos(a) * r1), (float)(oy + Math.Sin(a) * r1), (float)(cx + Math.Cos(a) * r2), (float)(oy + Math.Sin(a) * r2));
                    }
                    if (state == "listen") using (var p = new Pen(Color.FromArgb((int)(120 + 80 * Math.Sin(t * 3)), Acc), r * 0.06f)) g.DrawEllipse(p, (float)cx - r * 0.62f, oy - r * 0.62f, r * 1.24f, r * 1.24f);
                }
                string st = state == "listen" ? "OUVINDO" : state == "think" ? "PENSANDO" : state == "speak" ? "FALANDO" : "JARVIS";
                using (var f = new Font("Consolas", (float)(H * 0.0115), FontStyle.Bold, GraphicsUnit.Pixel)) Center(g, Spaced(st), f, Color.FromArgb(210, Acc), cx, oy + r * 1.95f);

                // ---- Barra fina no topo: modos | recursos | arquivos na fila ----
                TopBar(g, (float)cx, (float)(H * 0.014), (float)(H * 0.0135));

                // ---- Centro: o que você disse e a legenda (palavra atual em âmbar) ----
                float yy = (float)(H * 0.172), capBottom = (float)(H * 0.235);
                if (!string.IsNullOrWhiteSpace(you) && state != "speak")
                    using (var f = new Font("Segoe UI", (float)(H * 0.016), FontStyle.Italic, GraphicsUnit.Pixel)) Center(g, Clip(g, "“" + you.Trim('“', '”', ' ') + "”", f, bw * 0.5f), f, Color.FromArgb(200, Mute), cx, yy);
                PickCaption();
                if (dragOver) using (var f = new Font("Segoe UI", (float)(H * 0.024), FontStyle.Bold, GraphicsUnit.Pixel)) Center(g, "Solte para enviar ao Jarvis", f, Acc, cx, (float)(H * 0.212));
                else if (words.Length > 0) capBottom = DrawCaption(g, (float)cx, (float)(H * 0.212), (float)(H * 0.034), bw * 0.56f);
                else if (state == "listen" && string.IsNullOrWhiteSpace(you))
                    using (var f = new Font("Segoe UI", (float)(H * 0.019), FontStyle.Regular, GraphicsUnit.Pixel)) Center(g, "Pois não, senhor?", f, Color.FromArgb(200, Text0), cx, (float)(H * 0.215));

                // ---- Slide, centrado embaixo da legenda, sem passar da borda do V ----
                if (!string.IsNullOrWhiteSpace(slideT) || points.Length > 0) DrawSlide(g, (float)cx, Math.Max(capBottom + (float)(H * 0.012), (float)(H * 0.262)), H);
            }
            show:
            if (!present) return;
            // Mostra (a tela de desenho já é a DIB), com o esmaecer do aparecer/sumir.
            IntPtr screen = W.GetDC(IntPtr.Zero), mem = W.CreateCompatibleDC(screen), old = W.SelectObject(mem, dib);
            var size = new W.SIZE(bw, bh); var src = new W.POINT(0, 0); var dst = new W.POINT(bx, by);
            var blend = new W.BLENDFUNCTION { Op = 0, Flags = 0, Alpha = alpha, Format = 1 };
            W.UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, W.ULW_ALPHA);
            W.SelectObject(mem, old); W.DeleteDC(mem); W.ReleaseDC(IntPtr.Zero, screen);
        }

        // Qual grupo e qual palavra mostrar. Com a fala cronometrada, calcula pelo relógio (a hora em que o áudio começou +
        // o início de cada palavra), sem esperar mensagem por palavra. Sem tempos, usa o que a página mandou.
        void PickCaption()
        {
            string key;
            if (fW != null && fW.Length > 0 && fS != null && fS.Length == fW.Length)
            {
                double el = (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - fT0) / 1000.0 + 0.05;
                int idx = -1; for (int i = 0; i < fS.Length; i++) if (fS[i] <= el) idx = i;
                int gi = 0; for (int j = 0; j < fG.Length; j++) if (fG[j].Contains(Math.Max(0, idx))) { gi = j; break; }
                var grp = fG[gi].Where(k => k >= 0 && k < fW.Length).ToArray();
                words = grp.Select(k => fW[k]).ToArray(); wordOn = idx < 0 ? -1 : Array.IndexOf(grp, idx);
                key = fW.GetHashCode() + ":" + gi;
            }
            else key = string.Join(" ", words);
            if (key != lastKey) { lastKey = key; groupAt = DateTime.Now; wOp = new float[words.Length]; wLift = new float[words.Length]; wHot = new float[words.Length]; }
        }
        string lastKey = ""; double msSum; int nFrames;

        // Legenda centralizada em até 2 linhas, animada como a do app: o grupo entra subindo e aparecendo; cada palavra
        // vai suave até o alvo (próximas apagadas, ditas em branco, a atual em âmbar, um pouco acima e com brilho).
        float DrawCaption(Graphics g, float cx, float y, float px, float maxW)
        {
            var now = DateTime.Now; float dt = (float)Math.Min(0.1, (now - lastFrame).TotalSeconds); lastFrame = now;
            float k = 1f - (float)Math.Exp(-dt / 0.07), appear = (float)Math.Min(1, (now - groupAt).TotalSeconds / 0.22);
            appear = 1 - (1 - appear) * (1 - appear);
            if (wOp.Length != words.Length) { wOp = new float[words.Length]; wLift = new float[words.Length]; wHot = new float[words.Length]; }
            for (int i = 0; i < words.Length; i++)
            {
                float to = i <= wordOn ? 1f : 0.42f, th = i == wordOn ? 1f : 0f;
                if (wOp[i] == 0) wOp[i] = to;   // palavra nova já nasce no lugar (o grupo inteiro é que aparece)
                wOp[i] += (to - wOp[i]) * k; wHot[i] += (th - wHot[i]) * k; wLift[i] += (th - wLift[i]) * k;
            }
            using (var f = new Font("Segoe UI Semibold", px, FontStyle.Regular, GraphicsUnit.Pixel))
            {
                var sp = g.MeasureString(" ", f).Width * 0.55f;
                var lines = new List<List<int>> { new List<int>() }; float lw = 0;
                var ws = words.Select(w => g.MeasureString(w, f, PointF.Empty, StringFormat.GenericTypographic).Width).ToArray();
                for (int i = 0; i < words.Length; i++) { if (lw > 0 && lw + sp + ws[i] > maxW && lines.Count < 2) { lines.Add(new List<int>()); lw = 0; } lines[lines.Count - 1].Add(i); lw += (lw > 0 ? sp : 0) + ws[i]; }
                float rise = (1 - appear) * px * 0.3f;
                for (int l = 0; l < lines.Count; l++)
                {
                    float w = lines[l].Sum(i => ws[i]) + sp * (lines[l].Count - 1), x = cx - w / 2, ly = y + l * px * 1.25f + rise;
                    foreach (int i in lines[l])
                    {
                        float yy = ly - wLift[i] * px * 0.06f, a = wOp[i] * appear, h = wHot[i];
                        if (h > 0.05f)   // brilho âmbar em volta da palavra atual
                            using (var gb = new SolidBrush(Color.FromArgb((int)(34 * h * appear), Acc)))
                                for (int o = 0; o < 8; o++) { double an = o * Math.PI / 4; g.DrawString(words[i], f, gb, x + (float)Math.Cos(an) * px * 0.09f, yy + (float)Math.Sin(an) * px * 0.09f, StringFormat.GenericTypographic); }
                        using (var sh = new SolidBrush(Color.FromArgb((int)(140 * appear), 0, 0, 0))) g.DrawString(words[i], f, sh, x + 1.5f, yy + 2, StringFormat.GenericTypographic);
                        var c = Color.FromArgb(Math.Max(0, Math.Min(255, (int)(255 * a))), (int)(Text0.R + (Acc.R - Text0.R) * h), (int)(Text0.G + (Acc.G - Text0.G) * h), (int)(Text0.B + (Acc.B - Text0.B) * h));
                        using (var b = new SolidBrush(c)) g.DrawString(words[i], f, b, x, yy, StringFormat.GenericTypographic);
                        x += ws[i] + sp;
                    }
                }
                return y + lines.Count * px * 1.25f;
            }
        }
        // Barra fina no alto: "Talk · Code │ ● Agenda ● E-mails … │ arquivos na fila", centralizada, discreta.
        void TopBar(Graphics g, float cx, float y, float px)
        {
            using (var f = new Font("Segoe UI", px, FontStyle.Regular, GraphicsUnit.Pixel))
            using (var fb = new Font("Segoe UI Semibold", px, FontStyle.Regular, GraphicsUnit.Pixel))
            {
                var parts = new List<Tuple<string, Font, Color, int>>();   // texto, fonte, cor, 0 texto / 1 com ponto / 2 separador / 3 etiqueta
                parts.Add(Tuple.Create("Talk", modo == "talk" ? fb : f, modo == "talk" ? Text0 : Color.FromArgb(120, Mute), 0));
                parts.Add(Tuple.Create("·", f, Color.FromArgb(120, Mute), 0));
                parts.Add(Tuple.Create("Code", modo == "code" ? fb : f, modo == "code" ? Text0 : Color.FromArgb(120, Mute), 0));
                if (res.Count > 0) { parts.Add(Tuple.Create("│", f, Color.FromArgb(70, Mute), 2)); foreach (var r in res) parts.Add(Tuple.Create(r.Key, f, r.Value ? Color.FromArgb(225, Text0) : Color.FromArgb(105, Mute), r.Value ? 1 : -1)); }
                if (files.Length > 0) { parts.Add(Tuple.Create("│", f, Color.FromArgb(70, Mute), 2)); foreach (var n in files) parts.Add(Tuple.Create(Clip(g, n, f, bw * 0.1f), f, Text0, 3)); }
                float gap = px * 0.9f, dot = px * 0.42f, pad = px * 0.6f;
                var ws = parts.Select(p => g.MeasureString(p.Item1, p.Item2).Width + (p.Item4 == 1 || p.Item4 == -1 ? dot + px * 0.35f : 0) + (p.Item4 == 3 ? pad * 2 : 0)).ToArray();
                float x = cx - (ws.Sum() + gap * (ws.Length - 1)) / 2;
                for (int i = 0; i < parts.Count; i++)
                {
                    var p = parts[i]; float tx = x;
                    if (p.Item4 == 1 || p.Item4 == -1)
                    {
                        using (var b = new SolidBrush(p.Item4 == 1 ? Acc : Color.FromArgb(80, Mute))) g.FillEllipse(b, x, y + px * 0.42f, dot, dot);
                        tx = x + dot + px * 0.35f;
                    }
                    if (p.Item4 == 3)
                        using (var path = Round(new RectangleF(x, y - px * 0.12f, ws[i], px * 1.6f), px * 0.8f))
                        using (var pen = new Pen(Color.FromArgb(160, Acc), 1.2f)) { g.DrawPath(pen, path); tx = x + pad; }
                    using (var b = new SolidBrush(p.Item3)) g.DrawString(p.Item1, p.Item2, b, tx, y);
                    if (p.Item1 == "Talk" || p.Item1 == "Code") if ((p.Item1 == "Talk") == (modo == "talk")) using (var pen = new Pen(Acc, 2f)) g.DrawLine(pen, x + 2, y + px * 1.45f, x + ws[i] - 4, y + px * 1.45f);
                    x += ws[i] + gap;
                }
            }
        }

        // Metade da largura do V numa altura y (o escuro afina para baixo); o slide não passa dela.
        float HalfAt(float y) { double v = (0.98 - y / bh) / 0.62; return v <= 0 ? 0 : (float)(Math.Pow(v, 1 / 0.9) * bw / 2); }

        // Slide embaixo da legenda: "01 / 03  Título" numa linha e os pontos centralizados, cada um cortado na largura do V ali.
        void DrawSlide(Graphics g, float cx, float y, double H)
        {
            using (var lab = new Font("Consolas", (float)(H * 0.0125), FontStyle.Bold, GraphicsUnit.Pixel))
            using (var tf = new Font("Segoe UI Semibold", (float)(H * 0.021), FontStyle.Regular, GraphicsUnit.Pixel))
            using (var pf = new Font("Segoe UI", (float)(H * 0.0158), FontStyle.Regular, GraphicsUnit.Pixel))
            {
                string idx = slideN > 1 ? (slideI + 1).ToString("00") + " / " + slideN.ToString("00") + "   " : "";
                float max = HalfAt(y + (float)(H * 0.03)) * 1.7f;
                string title = Clip(g, slideT, tf, Math.Max(80, max - g.MeasureString(idx, lab).Width));
                float wi = idx.Length > 0 ? g.MeasureString(idx, lab).Width : 0, wt = g.MeasureString(title, tf).Width, x = cx - (wi + wt) / 2;
                if (wi > 0) using (var b = new SolidBrush(Color.FromArgb(200, Acc))) g.DrawString(idx, lab, b, x, y + (float)(H * 0.006));
                using (var b = new SolidBrush(Text0)) g.DrawString(title, tf, b, x + wi, y);
                y += (float)(H * 0.032);
                foreach (var p in points)
                {
                    float room = HalfAt(y + (float)(H * 0.024)) * 1.7f;
                    if (room < bw * 0.12f) break;   // o V já ficou estreito demais
                    string line = Clip(g, p, pf, room);
                    float w = g.MeasureString(line, pf).Width, d = (float)(H * 0.0055), lx = cx - (w + d * 3) / 2;
                    using (var b = new SolidBrush(Acc)) g.FillEllipse(b, lx, y + (float)(H * 0.008), d, d);
                    using (var b = new SolidBrush(Color.FromArgb(215, Text0))) g.DrawString(line, pf, b, lx + d * 3, y);
                    y += (float)(H * 0.025);
                }
            }
        }

        // Etiquetas dos arquivos na fila: contorno âmbar fino em volta de cada nome, centralizadas.
        static void Chips(Graphics g, string[] names, Font f, float cx, float y)
        {
            float pad = f.Size * 0.8f, gap = f.Size * 0.7f, h = f.Size * 1.9f;
            var ws = names.Select(n => g.MeasureString(n, f).Width + pad * 2).ToArray();
            float x = cx - (ws.Sum() + gap * (ws.Length - 1)) / 2;
            for (int i = 0; i < names.Length; i++)
            {
                using (var path = Round(new RectangleF(x, y, ws[i], h), h / 2))
                {
                    using (var b = new SolidBrush(Color.FromArgb(150, 20, 21, 26))) g.FillPath(b, path);
                    using (var p = new Pen(Color.FromArgb(160, Acc), 1.2f)) g.DrawPath(p, path);
                }
                using (var b = new SolidBrush(Text0)) g.DrawString(names[i], f, b, x + pad, y + (h - f.Size * 1.35f) / 2);
                x += ws[i] + gap;
            }
        }
        static GraphicsPath Round(RectangleF r, float rad)
        {
            var p = new GraphicsPath(); float d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90); p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure();
            return p;
        }
        static string Spaced(string s) { return string.Join(" ", s.ToCharArray()); }
        static void Center(Graphics g, string s, Font f, Color c, double cx, float y) { var sz = g.MeasureString(s, f); using (var b = new SolidBrush(c)) g.DrawString(s, f, b, (float)(cx - sz.Width / 2), y); }
        static void AtLeft(Graphics g, string s, Font f, Color c, float x, float y) { using (var b = new SolidBrush(c)) g.DrawString(s, f, b, x, y); }
        static string Clip(Graphics g, string s, Font f, float max) { if (g.MeasureString(s, f).Width <= max) return s; while (s.Length > 4 && g.MeasureString(s + "…", f).Width > max) s = s.Substring(0, s.Length - 1); return s + "…"; }

        protected override void Dispose(bool disposing)
        {
            frame.Dispose(); if (bg != null) bg.Dispose(); if (canvas != null) canvas.Dispose();
            if (dib != IntPtr.Zero) { W.DeleteObject(dib); dib = IntPtr.Zero; }
            base.Dispose(disposing);
        }
    }
}
