// O "app do site todo": sobe o servidor do Jarvis (se ainda não estiver no ar) e abre o site numa janela própria
// (Chrome/Edge em modo app, sem barra de endereço). O navegador é usado porque o reconhecimento de voz e o microfone
// do Jarvis dependem dele. O servidor iniciado aqui morre junto com este app (job object).
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;

namespace JarvisDesktop
{
    static class ServerHost
    {
        static Process server;

        public static bool Healthy(string url)
        {
            try
            {
                var r = (HttpWebRequest)WebRequest.Create(url + "/api/health"); r.Timeout = 3000; r.Proxy = null;
                using (var resp = (HttpWebResponse)r.GetResponse()) return resp.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        // Roda numa thread de fundo. Devolve "ok" quando o Jarvis está respondendo.
        public static string EnsureServer(Config c)
        {
            if (Healthy(c.ApiBase)) return "ok";
            if (!c.iniciarServidor) return "servidor desligado no config.json";
            string dir = c.Full(c.pastaJarvis);
            if (!File.Exists(Path.Combine(dir, "server.js"))) return "não achei o Jarvis em " + dir + " (ajuste \"pastaJarvis\" no config.json)";
            var psi = new ProcessStartInfo(c.node, File.Exists(Path.Combine(dir, ".env")) ? "--env-file=.env server.js" : "server.js")
            {
                WorkingDirectory = dir, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            psi.EnvironmentVariables["PORT"] = new Uri(c.jarvisUrl).Port.ToString();
            try { server = Process.Start(psi); }
            catch (Exception e) { return "não consegui iniciar o Node (" + e.Message + "). Ele está instalado?"; }
            W.KillWithMe(server.Handle);
            DataReceivedEventHandler log = (s, e) => { if (e.Data != null) ServerLog(e.Data); };
            server.OutputDataReceived += log; server.ErrorDataReceived += log;
            server.BeginOutputReadLine(); server.BeginErrorReadLine();
            Log.Write("servidor do Jarvis iniciado (pid " + server.Id + ")");
            for (int i = 0; i < 80; i++)
            {
                if (Healthy(c.ApiBase)) return "ok";
                if (server.HasExited) return "o servidor fechou sozinho; veja logs\\jarvis-servidor.log";
                Thread.Sleep(250);
            }
            return "o servidor não respondeu a tempo";
        }

        static readonly object gate = new object();
        static void ServerLog(string line)
        {
            try { lock (gate) { string d = Path.Combine(Config.Dir, "logs"); Directory.CreateDirectory(d); File.AppendAllText(Path.Combine(d, "jarvis-servidor.log"), line + Environment.NewLine, Encoding.UTF8); } }
            catch { }
        }

        public static string BrowserExe(Config c)
        {
            string exe = c.navegadorApp;
            if (string.IsNullOrEmpty(exe) || exe == "chrome")
            {
                string chrome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe");
                exe = File.Exists(chrome) ? chrome : "msedge";
            }
            return exe;
        }

        // Perfil próprio do navegador para o Jarvis (o mesmo da janela flutuante): microfone liberado uma vez, voz sem clique,
        // e a mesma sessão em todas as janelas do Jarvis.
        public static string ProfileDir { get { return Path.Combine(Config.Dir, "navegador-flutuante"); } }

        // O Jarvis completo como aplicativo: janela própria (sem abas nem barra de endereço), direto no app (/app), no perfil do Jarvis.
        // Se a janela flutuante já estiver aberta, o navegador abre esta no mesmo processo (mesma sessão).
        // Janelas do app completo (título "JARVIS", do Chrome/Edge), inclusive minimizadas. A flutuante é filha da moldura: não entra.
        static System.Collections.Generic.List<IntPtr> AppWindows()
        {
            var list = new System.Collections.Generic.List<IntPtr>();
            W.EnumWindows((h, l) =>
            {
                if (W.IsWindowVisible(h) && W.Text(h) == "JARVIS")
                {
                    string pn = Mouse.ProcName(h);
                    if (pn.Equals("chrome", StringComparison.OrdinalIgnoreCase) || pn.Equals("msedge", StringComparison.OrdinalIgnoreCase)) list.Add(h);
                }
                return true;
            }, IntPtr.Zero);
            return list;
        }
        // Modo flutuante ligado: a janela grande sai da frente (fica na barra de tarefas; "Abrir completo" traz de volta).
        public static void MinimizeApp() { var ws = AppWindows(); foreach (var h in ws) W.ShowWindow(h, 6 /* SW_MINIMIZE */); Log.Write("app completo: " + ws.Count + " janela(s) recolhida(s)"); }

        // Janela "Correio do Jarvis" (/correio): traz a que já está aberta ou abre uma nova, no centro do monitor principal.
        public const string MailTitle = "JARVIS · Correio";
        public static IntPtr MailWindow()
        {
            var w = Desktop.List().FirstOrDefault(x => x.Title == MailTitle && (x.Proc.Equals("chrome", StringComparison.OrdinalIgnoreCase) || x.Proc.Equals("msedge", StringComparison.OrdinalIgnoreCase)));
            return w == null ? IntPtr.Zero : w.H;
        }
        public static void OpenMail(Config c, string entregar)
        {
            var open = MailWindow();
            if (open != IntPtr.Zero) { W.ShowWindow(open, 9 /* SW_RESTORE */); Desktop.BringToFront(open); Log.Write("correio: janela trazida para a frente"); return; }
            var wa = System.Windows.Forms.Screen.PrimaryScreen.WorkingArea; int ww = Math.Min(1040, wa.Width - 120), wh = Math.Min(720, wa.Height - 160);
            string args = "--user-data-dir=\"" + ProfileDir + "\" " + DarkArgs + " --no-first-run --no-default-browser-check" +
                " --app=\"" + c.jarvisUrl + "/correio" + (string.IsNullOrEmpty(entregar) ? "" : "?entregar=" + Uri.EscapeDataString(entregar)) + "\"" +
                " --window-size=" + ww + "," + wh + " --window-position=" + (wa.Left + (wa.Width - ww) / 2) + "," + (wa.Top + (wa.Height - wh) / 2 + 40);
            try { using (Process.Start(new ProcessStartInfo(BrowserExe(c), args) { UseShellExecute = true })) { } Log.Write("correio: janela aberta"); }
            catch (Exception e) { Log.Write("correio: não consegui abrir a janela: " + e.Message); }
        }

        // Janelas do Jarvis com a cara dele: barra de título escura (o Chrome só escurece a barra das janelas de app no modo
        // escuro; o theme-color da página ele ignora) e uma borda âmbar discreta (cor do Jarvis, pelo próprio Windows 11).
        public const string DarkArgs = "--force-dark-mode";
        public static void Style(IntPtr h)
        {
            if (h == IntPtr.Zero) return;
            try { int on = 1, border = 0x00245A86; W.DwmSetWindowAttribute(h, 20, ref on, 4); W.DwmSetWindowAttribute(h, 34, ref border, 4); } catch { }
        }

        // Chamado de tempos em tempos: estiliza as janelas novas do Jarvis (app completo e correio), uma vez cada.
        static readonly System.Collections.Generic.HashSet<IntPtr> styled = new System.Collections.Generic.HashSet<IntPtr>();
        public static void StyleWindows()
        {
            foreach (var h in AppWindows().Concat(new[] { MailWindow() })) if (h != IntPtr.Zero && styled.Add(h)) Style(h);
            if (styled.Count > 50) styled.RemoveWhere(h => !W.IsWindow(h));
        }

        public static void OpenApp(Config c)
        {
            // Já aberta (mesmo minimizada)? Traz de volta em vez de abrir outra.
            var open = AppWindows();
            if (open.Count > 0) { Desktop.BringToFront(open[0]); PlaceAppWindow(new System.Collections.Generic.HashSet<IntPtr>()); Log.Write("app completo: janela trazida de volta"); return; }
            string exe = BrowserExe(c);
            string args = "--user-data-dir=\"" + ProfileDir + "\" " + DarkArgs + " --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required" +
                " --app=\"" + c.jarvisUrl + "/app\" --window-size=1280,860";
            var before = new System.Collections.Generic.HashSet<IntPtr>(Desktop.List().Where(IsAppWindow).Select(w => w.H));
            try { using (Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = true })) { } Log.Write("app completo aberto"); }
            catch (Exception e) { Log.Write("não consegui abrir a janela do Jarvis: " + e.Message); return; }
            PlaceAppWindow(before);
        }
        static bool IsAppWindow(WinInfo w) { return w.Title == "JARVIS" && (w.Proc.Equals("chrome", StringComparison.OrdinalIgnoreCase) || w.Proc.Equals("msedge", StringComparison.OrdinalIgnoreCase)); }

        // O Chrome lembra a posição das janelas de app pelo endereço, e o app completo herdava a da janela flutuante
        // (que nasce escondida em -3000,-3000, 430x240): abria "vazio", fora da tela. Aqui a janela nova vai para o centro
        // do monitor principal, em tamanho normal, e para a frente.
        static void PlaceAppWindow(System.Collections.Generic.HashSet<IntPtr> before)
        {
            var t = new System.Windows.Forms.Timer { Interval = 250 }; int ticks = 0;
            t.Tick += (s, e) =>
            {
                bool done = false;
                // A janela nova (que não existia antes); depois de 3 s sem ela, serve qualquer janela do app (ex.: uma escondida).
                foreach (var w in Desktop.List())
                {
                    if (!IsAppWindow(w) || (before.Contains(w.H) && ticks < 12)) continue;
                    var mon = Desktop.MonitorAt(w.R.L + w.R.Width / 2, w.R.T + 10);
                    bool onScreen = w.R.L + w.R.Width / 2 >= mon.Area.L && w.R.L + w.R.Width / 2 <= mon.Area.R && w.R.T >= mon.Area.T - 10 && w.R.T < mon.Area.B - 40;
                    if (!onScreen || w.R.Width < 700 || w.R.Height < 500)
                    {
                        var wa = System.Windows.Forms.Screen.PrimaryScreen.WorkingArea;
                        int ww = Math.Min(wa.Width - 40, (int)(1280 * Desktop.MonitorAt(wa.Left + 10, wa.Top + 10).Scale)), hh = Math.Min(wa.Height - 40, (int)(860 * Desktop.MonitorAt(wa.Left + 10, wa.Top + 10).Scale));
                        W.MoveWindow(w.H, wa.Left + (wa.Width - ww) / 2, wa.Top + (wa.Height - hh) / 2, ww, hh, true);
                        Log.Write("app completo: janela trazida para a tela (" + w.R + ")");
                    }
                    Desktop.BringToFront(w.H); done = true; break;   // a mais da frente é a que acabou de abrir
                }
                if (done || ++ticks > 40) { t.Stop(); t.Dispose(); }
            };
            t.Start();
        }

        public static void StopServer()
        {
            try { if (server != null && !server.HasExited) { server.Kill(); server.WaitForExit(2000); } } catch { }
        }
    }
}
