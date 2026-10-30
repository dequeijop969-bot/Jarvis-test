// Recorta as animações do mascote de uma "vitrine" em GIF (grade de 5 colunas, cada célula uma animação com o nome em cima).
// Para cada célula: junta os quadros do GIF, remove o fundo liso (fica transparente), volta ao tamanho nativo do
// pixel art (blocos de 3x3 → 1 px), tira quadros repetidos em sequência e grava:
//   <saida>\<nome>_NN.png  e  <saida>\<nome>.txt  (uma linha por quadro: "NN ms").
// Todas as células usam o MESMO recorte relativo ao chão, então o ponto de apoio (pés) é fixo: <saida>\ancora.txt = "x y".
// Uso: GifSprites.exe vitrine.gif pasta_saida
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

static class GifSprites
{
    static readonly string[] Names = { "parado", "andar", "correr", "pular", "pensar", "digitar", "acenar", "cumprimentar", "arrastado", "dormir",
        "feliz", "triste", "bravo", "surpreso", "confuso", "apaixonado", "tonto" };
    const int Cols = 5, CellW = 195, Block = 3;
    static readonly int[] Floor = { 210, 435, 660, 885 };   // primeira linha da faixa do chão em cada fileira (225 px entre elas)
    const int Top = 27;                           // acima disso (na célula) fica o nome da animação

    static int Main(string[] a)
    {
        if (a.Length < 2) { Console.Error.WriteLine("uso: GifSprites vitrine.gif pasta"); return 1; }
        Directory.CreateDirectory(a[1]);
        using (var gif = Image.FromFile(a[0]))
        {
            var dim = new FrameDimension(gif.FrameDimensionsList[0]); int n = gif.GetFrameCount(dim);
            var delays = gif.GetPropertyItem(0x5100).Value;
            var frames = new List<int[]>(); var ms = new List<int>(); int W = gif.Width, H = gif.Height;
            for (int i = 0; i < n; i++)
            {
                gif.SelectActiveFrame(dim, i);
                using (var b = new Bitmap(W, H, PixelFormat.Format32bppArgb))
                {
                    using (var g = Graphics.FromImage(b)) g.DrawImage(gif, 0, 0, W, H);
                    var d = b.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    var px = new int[W * H]; Marshal.Copy(d.Scan0, px, 0, px.Length); b.UnlockBits(d); frames.Add(px);
                }
                ms.Add(Math.Max(20, BitConverter.ToInt32(delays, i * 4) * 10));
            }
            int bg = frames[0][5 * W + 5];   // fundo liso da célula
            // Recorte comum: da linha Top até o chão, largura da célula; alinhado aos blocos de 3 pelo próprio chão.
            int outH = (Floor[0] - Top) / Block, outW = (CellW - 3) / Block;
            int ax = -1;
            for (int c = 0; c < Names.Length; c++)
            {
                int col = c % Cols, row = c / Cols, x0 = col * CellW, yFloor = Floor[row], y0 = yFloor - outH * Block;
                // Alinhamento horizontal dos blocos: o deslocamento (0..2) em que os blocos 3x3 ficam mais uniformes.
                int bestOx = 0, bestBad = int.MaxValue;
                for (int ox = 0; ox < Block; ox++)
                {
                    int bad = 0;
                    for (int by = 0; by < outH; by++) for (int bx = 0; bx < outW - 1; bx++)
                    {
                        int sx = x0 + ox + bx * Block, sy = y0 + by * Block, v = frames[0][sy * W + sx];
                        for (int k = 1; k < Block; k++) { if (frames[0][sy * W + sx + k] != v) bad++; if (frames[0][(sy + k) * W + sx] != v) bad++; }
                    }
                    if (bad < bestBad) { bestBad = bad; bestOx = ox; }
                }
                // Reduz cada quadro e junta os repetidos.
                var uniq = new List<int[]>(); var dur = new List<int>();
                for (int f = 0; f < frames.Count; f++)
                {
                    var o = new int[outW * outH];
                    for (int by = 0; by < outH; by++) for (int bx = 0; bx < outW; bx++)
                    {
                        int sx = x0 + bestOx + bx * Block + 1, sy = y0 + by * Block + 1;   // centro do bloco
                        if (sx >= x0 + CellW - 3) continue;
                        int v = frames[f][sy * W + sx];
                        o[by * outW + bx] = v == bg ? 0 : v;
                    }
                    if (uniq.Count > 0 && uniq[uniq.Count - 1].SequenceEqual(o)) dur[dur.Count - 1] += ms[f];
                    else { uniq.Add(o); dur.Add(ms[f]); }
                }
                // O GIF é um laço: se o último quadro é igual ao primeiro, junta.
                if (uniq.Count > 1 && uniq[uniq.Count - 1].SequenceEqual(uniq[0])) { dur[0] += dur[dur.Count - 1]; uniq.RemoveAt(uniq.Count - 1); dur.RemoveAt(dur.Count - 1); }
                // A vitrine repete o ciclo até completar 4 s (o pulo é o mesmo ciclo de 8 quadros 4 vezes): guarda só um.
                for (int p = 1; p <= uniq.Count / 2; p++)
                {
                    if (uniq.Count % p != 0) continue;
                    bool same = true;
                    for (int i = p; i < uniq.Count && same; i++) same = dur[i] == dur[i % p] && uniq[i].SequenceEqual(uniq[i % p]);
                    if (same) { uniq.RemoveRange(p, uniq.Count - p); dur.RemoveRange(p, dur.Count - p); break; }
                }
                var lines = new List<string>();
                for (int i = 0; i < uniq.Count; i++)
                {
                    using (var b = new Bitmap(outW, outH, PixelFormat.Format32bppArgb))
                    {
                        var d = b.LockBits(new Rectangle(0, 0, outW, outH), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                        Marshal.Copy(uniq[i], 0, d.Scan0, uniq[i].Length); b.UnlockBits(d);
                        b.Save(Path.Combine(a[1], string.Format("{0}_{1:00}.png", Names[c], i + 1)), ImageFormat.Png);
                    }
                    lines.Add(string.Format("{0:00} {1}", i + 1, dur[i]));
                }
                File.WriteAllLines(Path.Combine(a[1], Names[c] + ".txt"), lines);
                // Ponto de apoio: centro dos pés do "parado" no primeiro quadro (linha de baixo = chão).
                if (c == 0)
                {
                    int mn = outW, mx = -1;
                    for (int by = outH - 3; by < outH; by++) for (int bx = 0; bx < outW; bx++) if (uniq[0][by * outW + bx] != 0) { mn = Math.Min(mn, bx); mx = Math.Max(mx, bx); }
                    ax = (mn + mx + 1) / 2;
                }
                Console.WriteLine("{0}: {1} quadros ({2} ms), alinhamento {3}, ruído {4}", Names[c], uniq.Count, dur.Sum(), bestOx, bestBad);
            }
            File.WriteAllText(Path.Combine(a[1], "ancora.txt"), ax + " " + outH);
            Console.WriteLine("tamanho {0}x{1}, apoio {2},{3}", outW, outH, ax, outH);
        }
        return 0;
    }
}
