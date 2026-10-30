// Gera notebook_01..48.png (6 expressões x 8 quadros): o mascote em pé ao lado de um notebook, digitando.
// O mascote é o think_01 original, pixel por pixel; as mãos viram dois cubos pretos digitando rápido e os olhos mudam de expressão.
// O notebook é de perfil, em tons de cinza: base no chão e tampa inclinada com a tela virada para o mascote.
// A tela solta uma luz azulada discreta (semitransparente), que oscila de leve e ilumina o teclado e o lado do mascote.
// Também grava notebook_ancora.txt: onde ficam os pés (o notebook não pode deslocar o boneco ao trocar de animação).
// Uso: NotebookFrames.exe sprites
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

static class NotebookFrames
{
    static Color C(int r, int g, int b) { return Color.FromArgb(255, r, g, b); }
    static readonly Color T = Color.FromArgb(0, 0, 0, 0), K = C(0, 0, 0), Wh = C(255, 255, 255);
    // Cinzas do notebook (mesma família da referência).
    static readonly Color Out = C(35, 35, 35), Back = C(65, 65, 65), Mid = C(109, 109, 109), Face = C(139, 139, 139), Hi = C(160, 160, 160);
    static readonly Color Deck = C(125, 125, 125), KeyC = C(80, 80, 80), Under = C(74, 74, 74);
    static readonly Color Screen = C(196, 232, 255), Light = C(170, 220, 255);

    const int Wd = 53, H = 31;
    // Notebook: base de x 29 a 44 (linhas 27..29); dobradiça na ponta direita; tampa sobe até (Top, 14).
    const int BaseL = 29, Hinge = 44, Top = 49, LidTopY = 14, LidBotY = 26;

    static int Main(string[] a)
    {
        string dir = a.Length > 0 ? a[0] : "sprites";
        Bitmap src;
        using (var img = Image.FromFile(Path.Combine(dir, "think_01.png"))) src = new Bitmap(img);
        // Grupos de 8 quadros, um por expressão. As mãos (cubos pretos) digitam rápido dentro do grupo (12 quadros/s);
        // o app troca de grupo devagar, seguindo notebook_expressoes.txt (grupo e segundos), então o rosto muda com calma.
        // Mãos: 0 = na tecla, 1 = levantada, 2 = bem alta (pausa/susto).
        var groups = new[] { "foco", "normal", "bravo", "feliz", "susto", "pisca" };
        var seq = new string[groups.Length * 8];
        for (int g = 0; g < groups.Length; g++) for (int k = 0; k < 8; k++) seq[g * 8 + k] = groups[g];
        int N = seq.Length;
        Directory.CreateDirectory(Path.Combine(dir, "previa"));
        foreach (var old in Directory.GetFiles(dir, "notebook_*.png")) File.Delete(old);   // apaga quadros de uma versão com outro total
        const int Z = 8;
        var bgs = new[] { C(235, 238, 242), C(28, 30, 36) };   // prévia em fundo claro e escuro
        var show = new[] { 0, 8, 16, 24, 32, 40, 1, 9 };         // prévia: um quadro de cada expressão (e mais dois com a outra mão)
        using (var strip = new Bitmap(Wd * Z * 4 + 3 * 8, (H * Z + 8) * 4))
        {
            using (var gs = Graphics.FromImage(strip)) gs.Clear(C(150, 160, 170));
            for (int i = 0; i < N; i++)
            {
                string ex = seq[i];
                int hl, hr;
                int k8 = i % 8;
                if (ex == "susto") { hl = hr = 2; }
                else if (ex == "feliz") { hl = hr = k8 % 4 < 2 ? 2 : 1; }   // pausa feliz: mãos pulando juntas
                else if (ex == "foco" && k8 == 7) { hl = hr = 0; }          // "Enter" com as duas
                else { hl = k8 % 2 == 0 ? 0 : 1; hr = 1 - hl; }
                var f = new { glow = 0.85 + 0.15 * Math.Sin(i * 0.9) };
                var b = new Bitmap(Wd, H, PixelFormat.Format32bppArgb);
                for (int y = 0; y < H; y++) for (int x = 0; x < Wd; x++) b.SetPixel(x, y, T);

                // ---- Notebook de perfil.
                // Base: tampo com teclas, lateral e fundo.
                Rect(b, BaseL, 27, Hinge, 27, Deck);
                for (int x = BaseL + 1; x < Hinge - 1; x += 2) b.SetPixel(x, 27, KeyC);
                Rect(b, BaseL, 28, Hinge + 1, 28, Mid); Rect(b, BaseL + 1, 29, Hinge, 29, Under);
                b.SetPixel(BaseL - 1, 28, Out); b.SetPixel(BaseL, 29, Out); b.SetPixel(Hinge + 1, 29, Out);
                Rect(b, BaseL, 26, BaseL + 1, 26, Out);   // pontinha da frente
                // Tampa: faixa de 3 px inclinada (tela | meio | costas) da dobradiça até o topo.
                for (int y = LidTopY; y <= LidBotY; y++)
                {
                    int cx = Hinge + (int)Math.Round((double)(LidBotY - y) * (Top - Hinge) / (LidBotY - LidTopY));
                    double lit = f.glow * (0.75 + 0.25 * Math.Sin(y * 1.7 + i));   // "conteúdo" mudando na tela
                    b.SetPixel(cx - 1, y, Mix(Face, Screen, Math.Max(0, Math.Min(1, lit))));
                    b.SetPixel(cx, y, Mid); b.SetPixel(cx + 1, y, Back); b.SetPixel(cx + 2, y, Out);
                }
                Rect(b, Top - 1, LidTopY - 1, Top + 1, LidTopY - 1, Out); b.SetPixel(Top, LidTopY - 1, Back);
                b.SetPixel(Hinge, 27, Out); b.SetPixel(Hinge + 1, 27, Back); b.SetPixel(Hinge + 2, 27, Out);   // dobradiça

                // ---- Mascote: o think_01 original, sem os tocos dos braços (as mãos agora são os cubos no teclado).
                for (int y = 0; y < src.Height; y++) for (int x = 0; x < src.Width; x++)
                {
                    var c = src.GetPixel(x, y); if (c.A <= 128) continue;
                    bool eye = c.R > 128 && y >= 12, arm = y >= 15 && y <= 21 && (x < 4 || x > 26);
                    if (arm) continue;
                    b.SetPixel(x, y, eye ? K : c);
                }
                // Olhos com a expressão do quadro, no lugar dos originais e 1 px para o lado da tela.
                Eye(b, 12, ex, false); Eye(b, 22, ex, true);
                // Mãos: cubos pretos 3x3. Na tecla, a tecla acende de leve.
                Hand(b, 31, hl); Hand(b, 36, hr);

                // ---- Luz da tela: leque fraco para a esquerda (teclado, mão e lado do mascote). Nunca nas 2 últimas linhas
                // (lá o app mede os pés) e sempre bem transparente: é um brilho, não um holofote.
                // Cada pixel à esquerda da tela recebe luz conforme a distância até ela (leque contínuo, sem pontilhado).
                for (int y = LidTopY; y <= 27; y++)
                {
                    int ly = Math.Min(y, LidBotY);
                    int sx = Hinge + (int)Math.Round((double)(LidBotY - ly) * (Top - Hinge) / (LidBotY - LidTopY)) - 2;
                    for (int d = 0; d < 15; d++)
                    {
                        int x = sx - d; if (x < 0) break;
                        double fall = 1 - d / 15.0, vert = y > LidBotY ? 0.6 : 1;   // no teclado a luz já chega mais fraca
                        Glow(b, x, y, Light, 0.26 * f.glow * fall * fall * vert);
                    }
                }

                string name = string.Format("notebook_{0:00}.png", i + 1);
                int slot = Array.IndexOf(show, i);
                b.Save(Path.Combine(dir, name), ImageFormat.Png);
                if (slot >= 0) using (var big = new Bitmap(Wd * Z, H * Z))
                {
                    for (int v = 0; v < 2; v++)
                    {
                        using (var g = Graphics.FromImage(big)) { g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor; g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half; g.Clear(bgs[v]); g.DrawImage(b, 0, 0, Wd * Z, H * Z); }
                        if (v == 0) big.Save(Path.Combine(dir, "previa", "notebook_" + ex + ".png"), ImageFormat.Png);
                        using (var gs = Graphics.FromImage(strip)) gs.DrawImage(big, (slot % 4) * (Wd * Z + 8), ((slot / 4) * 2 + v) * (H * Z + 8));
                    }
                }
                b.Dispose();
            }
            strip.Save(Path.Combine(dir, "previa", "notebook_tira.png"), ImageFormat.Png);
            Console.WriteLine(N + " quadros");
        }
        // Pés do mascote: o mesmo cálculo do app (faixa de baixo), feito só no think_01, sem o notebook.
        File.WriteAllText(Path.Combine(dir, "notebook_ancora.txt"), FeetCenter(src).ToString());
        // Roteiro das expressões: "grupo segundos" (0 foco, 1 normal, 2 determinado, 3 feliz, 4 susto, 5 piscando). Pode editar à mão.
        File.WriteAllText(Path.Combine(dir, "notebook_expressoes.txt"), string.Join(Environment.NewLine, new[] { "0 4", "5 0.15", "1 3", "2 3.5", "5 0.15", "0 3", "3 2", "1 2.5", "4 1", "5 0.15", "0 3" }));
        return 0;
    }

    // Olho (3 colunas, linhas 14..20) a partir da coluna x0. Desenhos do olho esquerdo; o direito espelha os assimétricos.
    static readonly System.Collections.Generic.Dictionary<string, string[]> Eyes = new System.Collections.Generic.Dictionary<string, string[]> {
        { "normal", new[] { "...", "###", "###", "###", "###", "###", ".##" } },   // o olho original
        { "foco",   new[] { "...", "...", "...", "###", "###", "###", ".##" } },   // pálpebra baixa, concentrado
        { "pisca",  new[] { "...", "...", "...", "...", "...", "###", "..." } },
        { "feliz",  new[] { "...", "...", ".#.", "#.#", "#.#", "...", "..." } },   // ^ ^
        { "susto",  new[] { "###", "#.#", "#.#", "#.#", "#.#", "###", "..." } },   // olho arregalado
        { "bravo",  new[] { "...", "#..", "##.", "###", "###", "###", ".##" } },   // determinado: sobrancelha caindo para o meio
    };
    static void Eye(Bitmap b, int x0, string ex, bool right)
    {
        var t = Eyes[ex]; bool flip = right && ex == "bravo";
        for (int r = 0; r < t.Length; r++) for (int c = 0; c < 3; c++)
            if (t[r][flip ? 2 - c : c] == '#') b.SetPixel(x0 + c, 14 + r, Wh);
    }
    static void Hand(Bitmap b, int x0, int lift)
    {
        int y0 = lift == 0 ? 24 : lift == 1 ? 22 : 20;
        Rect(b, x0, y0, x0 + 2, y0 + 2, K);
        if (lift == 0) b.SetPixel(x0 + 1, 27, Screen);   // tecla acesa
    }

    static Color Mix(Color a, Color b, double t) { return C((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t)); }

    // Soma luz por cima: em pixel opaco clareia a cor; em pixel vazio vira um brilho semitransparente.
    static void Glow(Bitmap b, int x, int y, Color l, double alpha)
    {
        if (alpha <= 0.01) return;
        var c = b.GetPixel(x, y);
        if (c.A == 255) { b.SetPixel(x, y, Mix(c, l, alpha * 0.8)); return; }
        double a0 = c.A / 255.0, a1 = a0 + alpha * (1 - a0);
        Func<int, int, int> ch = (p, q) => (int)Math.Round((p * a0 + q * alpha * (1 - a0)) / a1);
        b.SetPixel(x, y, Color.FromArgb((int)Math.Round(a1 * 255), ch(c.R, l.R), ch(c.G, l.G), ch(c.B, l.B)));
    }

    static int FeetCenter(Bitmap src)
    {
        int bottom = -1; for (int y = src.Height - 1; y >= 0 && bottom < 0; y--) for (int x = 0; x < src.Width; x++) if (src.GetPixel(x, y).A > 40) { bottom = y; break; }
        int band = Math.Max(1, H / 8), lo = 999, hi = -1;
        for (int y = Math.Max(0, bottom - band + 1); y <= bottom; y++) for (int x = 0; x < src.Width; x++) if (src.GetPixel(x, y).A > 40) { lo = Math.Min(lo, x); hi = Math.Max(hi, x); }
        return (lo + hi + 1) / 2;
    }
    static void Put(Bitmap b, int x, int y, Color c) { if (x >= 0 && y >= 0 && x < b.Width && y < b.Height) b.SetPixel(x, y, c); }

    static void Rect(Bitmap b, int x0, int y0, int x1, int y1, Color c)
    {
        for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < b.Width && y < b.Height) b.SetPixel(x, y, c);
    }
}
