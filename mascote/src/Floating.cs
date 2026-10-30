// Janela flutuante do Jarvis: o site em modo compacto (/app?mini=1) dentro de uma moldura do próprio app,
// no canto inferior esquerdo e sempre por cima das outras. Só o círculo de falar, o switch Talk/Code, a legenda e o que
// você disse; quando a IA faz slides, ela cresce e mostra os slides em miniatura.
//
// Como fica sem barra de título e levemente transparente: o navegador abre a página numa janela de app e este programa
// "adota" essa janela como filha de uma moldura própria (sem borda, cantos arredondados, opacidade "opacidadeFlutuante").
// A barra de título do navegador fica acima da área visível da moldura. O tamanho vem da página (evento "janela").
// Usa um perfil próprio do navegador (pasta navegador-flutuante) para poder tocar a voz sem um clique antes
// (o atalho de teclado começa a conversa sem tocar na página). O microfone é pedido uma vez nessa janela.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace JarvisDesktop
{
    class FloatHost : Form
    {
        public IntPtr Child;   // janela do navegador adotada
        bool big;
        public readonly double BaseOpacity;
        public const double VAlpha = 0.9;   // o V inteiro levemente translúcido
        public bool VShown;   // modo V: a página já está no layout do V (antes disso fica invisível, para não piscar o layout do canto)
        public FloatHost(double opacity)
        {
            FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; ShowInTaskbar = false; TopMost = true;
            AutoScaleMode = AutoScaleMode.None; BackColor = Color.FromArgb(12, 13, 16); Text = "Jarvis flutuante";
            Opacity = BaseOpacity = Math.Max(0.3, Math.Min(1, opacity));
            Place();
            // Fora das fotos da tela: quando o Jarvis "olha a tela", ele vê o que está embaixo, não a própria janela.
            HandleCreated += (s, e) => { if (!VOverlay.InPhotos) try { W.SetWindowDisplayAffinity(Handle, W.WDA_EXCLUDEFROMCAPTURE); } catch { } };
        }
        protected override CreateParams CreateParams { get { var cp = base.CreateParams; cp.ExStyle |= W.WS_EX_TOOLWINDOW | W.WS_EX_TOPMOST; return cp; } }
        protected override bool ShowWithoutActivation { get { return true; } }

        static double Dpi { get { var w = Screen.PrimaryScreen.WorkingArea; return Desktop.MonitorAt(w.Left + 10, w.Bottom - 10).Scale; } }
        static int TitleH { get { return (int)Math.Round(32 * Dpi); } }   // barra de título que o navegador desenha

        // Canto inferior esquerdo da área de trabalho do monitor principal. Compacta ou grande (com slides).
        // No modo V (chamado por "Jarvis"): a página ocupa o topo da tela, recortada no formato do V, por cima do escuro
        // (que dá a borda suave e o brilho). Assim o V mostra o próprio app: mesma legenda, círculo, slides e gráficos.
        public void Place()
        {
            double s = Dpi; var wa = Screen.PrimaryScreen.WorkingArea; var old = Region;
            if (Floating.Top)
            {
                var sc = Screen.PrimaryScreen.Bounds; int vh = (int)(sc.Height * VOverlay.HeightFrac);
                Bounds = new Rectangle(sc.Left, sc.Top, sc.Width, vh);
                using (var path = new System.Drawing.Drawing2D.GraphicsPath()) { path.AddPolygon(VOverlay.Core(sc.Width, vh)); Region = new Region(path); }
                Opacity = VShown ? VAlpha : 0;
            }
            else
            {
                int w = (int)Math.Round(424 * s), h = (int)Math.Round((big ? 580 : 190) * s), m = (int)Math.Round(10 * s);
                Bounds = new Rectangle(wa.Left + m, wa.Bottom - h - m, w, h);
                int rad = (int)Math.Round(18 * s);
                Region = Region.FromHrgn(W.CreateRoundRectRgn(0, 0, w + 1, h + 1, rad, rad));
            }
            if (old != null) old.Dispose();
            FitChild();
        }
        public void SetBig(bool v) { if (big == v) return; big = v; Place(); }
        public void FitChild()
        {
            if (Child == IntPtr.Zero || !W.IsWindow(Child)) return;
            // A barra fica acima da área visível. No V, as bordas laterais do navegador (~7 px pretos) também ficam de fora.
            int t = TitleH, side = Floating.Top ? (int)Math.Round(8 * Dpi) : 1;
            W.MoveWindow(Child, -side, -t, ClientSize.Width + 2 * side, ClientSize.Height + t + side, true);
        }

        // Adota a janela do navegador: vira filha desta moldura (sem barra, sem borda própria, sem botão na barra de tarefas).
        public void Adopt(IntPtr h)
        {
            Child = h;
            int st = W.GetWindowLong(h, W.GWL_STYLE);
            st = (st & ~unchecked((int)W.WS_POPUP) & ~W.WS_CAPTION & ~W.WS_THICKFRAME) | W.WS_CHILD;
            W.SetWindowLong(h, W.GWL_STYLE, st);
            W.SetParent(h, Handle);
            FitChild();
            if (!Visible) Show();
            Log.Write("janela flutuante: página encaixada na moldura");
        }
    }

    static class Floating
    {
        const string Suffix = "· flutuante";   // o título da página no modo flutuante termina assim
        public static double Opacity = 0.88;
        static FloatHost host;
        static bool top;
        // Modo V: a janela sai da tela enquanto o V mostra a conversa (e volta ao canto quando ela acaba).
        // Ao sair do V, a janela fica invisível um instante: a página troca do layout do V para o do canto (evento "fimv").
        public static bool Top
        {
            get { return top; }
            set
            {
                if (top == value) return; top = value;
                if (host == null || host.IsDisposed) return;
                host.VShown = false;
                if (!value) { host.Opacity = 0; var t = new System.Windows.Forms.Timer { Interval = 700 }; t.Tick += (s, e) => { t.Dispose(); if (!top && !host.IsDisposed) host.Opacity = host.BaseOpacity; }; t.Start(); }
                host.Place();
            }
        }
        // A página entrou no layout do V: aparece por cima do escuro.
        public static void ShowInV()
        {
            if (!top || host == null || host.IsDisposed || host.VShown) return;
            host.VShown = true; host.Opacity = FloatHost.VAlpha;
            W.SetWindowPos(host.Handle, W.HWND_TOPMOST, 0, 0, 0, 0, W.SWP_NOMOVE | W.SWP_NOSIZE | W.SWP_NOACTIVATE);
        }
        static WinInfo FindTopLevel()
        {
            return Desktop.List().FirstOrDefault(w => w.Title.TrimEnd().EndsWith(Suffix, StringComparison.Ordinal)
                && (w.Proc.Equals("chrome", StringComparison.OrdinalIgnoreCase) || w.Proc.Equals("msedge", StringComparison.OrdinalIgnoreCase)));
        }
        static bool Adopted { get { return host != null && !host.IsDisposed && host.Child != IntPtr.Zero && W.IsWindow(host.Child); } }
        public static bool IsOpen { get { return Adopted || FindTopLevel() != null; } }
        // A moldura da janela flutuante, quando está na tela (o Jarvis Code sobe nela para digitar).
        public static IntPtr Handle { get { return Adopted && host.Visible && !top ? host.Handle : IntPtr.Zero; } }

        public static void Open(Config c)
        {
            if (host == null || host.IsDisposed) host = new FloatHost(Opacity);
            if (Adopted) { host.Show(); return; }
            if (FindTopLevel() != null) return;   // já abrindo: o Tick adota
            string profile = ServerHost.ProfileDir;
            // --disable-gpu e --disable-direct-composition: a página desenha pelo caminho comum do Windows, que funciona como janela filha
            // e com a transparência da moldura. Só vale para esta janela (perfil próprio = processo próprio do navegador).
            // Abre fora da tela: só aparece já encaixada na moldura.
            // Sem "economia" de janela escondida: no modo V ela fica fora da tela e precisa seguir no tempo certo (legenda, voz).
            string args = "--user-data-dir=\"" + profile + "\" --force-dark-mode --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required" +
                " --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling" +
                " --disable-gpu --disable-direct-composition" +
                (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("JARVIS_DEPURAR_FLUTUANTE")) ? "" : " --remote-debugging-port=" + Environment.GetEnvironmentVariable("JARVIS_DEPURAR_FLUTUANTE")) +   // só para depurar a página
                " --app=\"" + c.jarvisUrl + "/app?mini=1\" --window-size=430,240 --window-position=-3000,-3000";
            try { using (Process.Start(new ProcessStartInfo(ServerHost.BrowserExe(c), args) { UseShellExecute = true })) { } Log.Write("janela flutuante: abrindo o navegador"); }
            catch (Exception e) { Log.Write("não consegui abrir a janela flutuante: " + e.Message); }
        }

        public static void Close()
        {
            if (Adopted) W.PostMessage(host.Child, W.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            else { var w = FindTopLevel(); if (w != null) W.PostMessage(w.H, W.WM_CLOSE, IntPtr.Zero, IntPtr.Zero); }
            if (host != null && !host.IsDisposed) { host.Child = IntPtr.Zero; host.Hide(); }
            Log.Write("janela flutuante fechada");
        }

        // A página pediu para crescer (slides) ou voltar ao compacto.
        public static void SetBig(bool v) { if (host != null && !host.IsDisposed) host.SetBig(v); }

        // Chamado de tempos em tempos: adota a janela do navegador quando ela aparece; some com a moldura se ela fechar.
        public static void Tick()
        {
            if (host == null || host.IsDisposed) return;
            if (Adopted) { if (!host.Visible) host.Show(); return; }
            if (host.Child != IntPtr.Zero) { host.Child = IntPtr.Zero; host.Hide(); Log.Write("janela flutuante: o navegador fechou"); }
            var w = FindTopLevel();
            if (w != null) host.Adopt(w.H);
        }

        public static void Dispose() { Close(); if (host != null && !host.IsDisposed) host.Dispose(); }

        // Atalho de falar: avisa a janela flutuante (ela alterna ouvir/parar). Se nenhuma estiver aberta, "noWindow" é chamado.
        // action "acordar" (chamado por "Jarvis"): começa a ouvir se estiver parada (não alterna).
        public static void Talk(Config c, Action noWindow, string action = null)
        {
            ThreadPool.QueueUserWorkItem(_ => { int n = TalkNow(c, action); if (n == 0 && noWindow != null) noWindow(); });
        }
        // Devolve quantas janelas flutuantes receberam o aviso (-1: o servidor não respondeu).
        public static int TalkNow(Config c, string action)
        {
                int n = -1;
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(c.ApiBase + "/api/ui/talk");
                    req.Method = "POST"; req.ContentType = "application/json"; req.Headers["x-jarvis"] = "1"; req.Proxy = null; req.Timeout = 3000;
                    var body = Encoding.UTF8.GetBytes(action == null ? "{}" : "{\"action\":\"" + action + "\"}");
                    using (var s = req.GetRequestStream()) s.Write(body, 0, body.Length);
                    using (var resp = req.GetResponse())
                    using (var rd = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        var m = System.Text.RegularExpressions.Regex.Match(rd.ReadToEnd(), "\"windows\"\\s*:\\s*(\\d+)");
                        if (m.Success) n = int.Parse(m.Groups[1].Value);
                    }
                }
                catch (Exception e) { Log.Write("atalho de falar: " + e.Message); }
                return n;
        }
    }
}

