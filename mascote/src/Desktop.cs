// Janelas e monitores do Windows: onde está cada janela, qual é a de um app, onde fica o "chão" abaixo do mascote.
// Só LEITURA de posições (mais trazer uma janela do app para a frente). Nada de clicar ou digitar em outras janelas.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace JarvisDesktop
{
    class WinInfo { public IntPtr H; public string Title, Proc; public W.RECT R; }
    class Monitor { public W.RECT Area, Work; public double Scale; }   // Scale: 1.0 = 100%, 1.25 = 125%...
    class Floor { public int Y; public IntPtr Win; }

    static class Desktop
    {
        static readonly HashSet<string> SkipClass = new HashSet<string> { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "NotifyIconOverflowWindow", "Windows.UI.Core.CoreWindow" };
        static readonly int MyPid = Process.GetCurrentProcess().Id;
        static readonly Dictionary<uint, string> procCache = new Dictionary<uint, string>();

        static string ProcName(uint pid)
        {
            string n;
            if (procCache.TryGetValue(pid, out n)) return n;
            try { n = Process.GetProcessById((int)pid).ProcessName; } catch { n = ""; }
            if (procCache.Count > 500) procCache.Clear();
            procCache[pid] = n; return n;
        }

        // Janelas "de verdade" visíveis, da frente para trás (ordem Z).
        public static List<WinInfo> List()
        {
            var list = new List<WinInfo>();
            W.EnumWindows((h, l) =>
            {
                if (!W.IsWindowVisible(h) || W.IsIconic(h) || W.Cloaked(h)) return true;
                if ((W.GetWindowLong(h, W.GWL_EXSTYLE) & W.WS_EX_TOOLWINDOW) != 0) return true;
                if (SkipClass.Contains(W.Class(h))) return true;
                uint pid; W.GetWindowThreadProcessId(h, out pid);
                if (pid == MyPid) return true;
                string title = W.Text(h);
                if (title.Length == 0) return true;
                var r = W.Bounds(h);
                if (r.Width < 150 || r.Height < 80) return true;
                list.Add(new WinInfo { H = h, Title = title, Proc = ProcName(pid), R = r });
                return true;
            }, IntPtr.Zero);
            return list;
        }

        public static bool Matches(WinInfo w, AppEntry a)
        {
            bool procOk = a.janela.processos.Count == 0 || a.janela.processos.Any(p => string.Equals(p, w.Proc, StringComparison.OrdinalIgnoreCase));
            bool titleOk = a.janela.titulos.Count == 0 || a.janela.titulos.Any(t => w.Title.IndexOf(t, StringComparison.OrdinalIgnoreCase) >= 0);
            return procOk && titleOk && (a.janela.processos.Count > 0 || a.janela.titulos.Count > 0);
        }
        public static WinInfo FindApp(AppEntry a) { return List().FirstOrDefault(w => Matches(w, a)); }
        public static HashSet<IntPtr> Snapshot(AppEntry a) { return new HashSet<IntPtr>(List().Where(w => Matches(w, a)).Select(w => w.H)); }

        // Janela ainda serve de apoio? (existe, visível, não minimizada, não escondida)
        public static bool Usable(IntPtr h) { return h != IntPtr.Zero && W.IsWindow(h) && W.IsWindowVisible(h) && !W.IsIconic(h) && !W.Cloaked(h); }

        public static Monitor MonitorAt(int x, int y)
        {
            IntPtr hm = W.MonitorFromPoint(new W.POINT(x, y), W.MONITOR_DEFAULTTONEAREST);
            var mi = new W.MONITORINFO(); mi.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(typeof(W.MONITORINFO));
            W.GetMonitorInfo(hm, ref mi);
            uint dx, dy; double scale = 1;
            try { if (W.GetDpiForMonitor(hm, 0, out dx, out dy) == 0) scale = dx / 96.0; } catch { }
            return new Monitor { Area = mi.rcMonitor, Work = mi.rcWork, Scale = scale };
        }

        // Monitores numerados como o Jarvis fala: 1 = principal, depois os outros da esquerda para a direita.
        public static List<Monitor> Monitors()
        {
            var screens = System.Windows.Forms.Screen.AllScreens
                .OrderBy(s => s.Primary ? 0 : 1).ThenBy(s => s.Bounds.Left).ThenBy(s => s.Bounds.Top).ToList();
            return screens.Select(s => MonitorAt(s.Bounds.Left + s.Bounds.Width / 2, s.Bounds.Top + s.Bounds.Height / 2)).ToList();
        }
        public static Monitor MonitorNumber(int n) { var all = Monitors(); return n >= 1 && n <= all.Count ? all[n - 1] : null; }

        // Leva a janela para o monitor pedido e maximiza lá (se ela já estiver nele, só maximiza).
        public static void MoveToMonitor(IntPtr h, Monitor m)
        {
            if (h == IntPtr.Zero || m == null) return;
            W.ShowWindow(h, W.SW_RESTORE);   // maximizada não muda de monitor; restaura, move e maximiza de novo
            var r = W.Bounds(h); int w = Math.Min(r.Width, m.Work.Width - 40), hh = Math.Min(r.Height, m.Work.Height - 40);
            W.MoveWindow(h, m.Work.L + (m.Work.Width - w) / 2, m.Work.T + (m.Work.Height - hh) / 2, w, hh, true);
            W.ShowWindow(h, 3 /* SW_MAXIMIZE */);
        }

        // Chão abaixo do ponto: o topo visível da janela mais alta embaixo dos pés, ou a barra de tarefas (base da área útil).
        public static Floor FloorBelow(int x, int y)
        {
            var mon = MonitorAt(x, y);
            var f = new Floor { Y = mon.Work.B, Win = IntPtr.Zero };
            var wins = List();
            for (int i = 0; i < wins.Count; i++)
            {
                var r = wins[i].R;
                if (x < r.L + 6 || x > r.R - 6 || r.T < y - 2 || r.T >= f.Y || r.T <= mon.Work.T + 4) continue;
                bool covered = false;   // a borda de cima precisa estar à vista (nenhuma janela na frente cobrindo)
                for (int j = 0; j < i && !covered; j++) if (wins[j].R.Contains(x, r.T + 3)) covered = true;
                if (!covered) { f.Y = r.T; f.Win = wins[i].H; }
            }
            return f;
        }

        // Foto de uma área da tela em JPEG (no máximo 1280 px de largura). O mascote não aparece nela:
        // CopyFromScreen sem CAPTUREBLT não inclui janelas em camadas como a dele.
        public static string CaptureJpeg(W.RECT r)
        {
            int w = Math.Max(1, r.Width), h = Math.Max(1, r.Height);
            using (var full = new System.Drawing.Bitmap(w, h))
            {
                using (var g = System.Drawing.Graphics.FromImage(full)) g.CopyFromScreen(r.L, r.T, 0, 0, new System.Drawing.Size(w, h));
                double k = Math.Min(1.0, 1280.0 / w);
                int tw = Math.Max(1, (int)(w * k)), th = Math.Max(1, (int)(h * k));
                using (var small = new System.Drawing.Bitmap(tw, th))
                {
                    using (var g = System.Drawing.Graphics.FromImage(small)) { g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; g.DrawImage(full, 0, 0, tw, th); }
                    var codec = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
                    var ps = new System.Drawing.Imaging.EncoderParameters(1);
                    ps.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
                    using (var ms = new System.IO.MemoryStream()) { small.Save(ms, codec, ps); return "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray()); }
                }
            }
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, int flags, IntPtr extra);
        public static void BringToFront(IntPtr h)
        {
            if (W.IsIconic(h)) W.ShowWindow(h, W.SW_RESTORE);
            // O Windows só deixa trocar a janela da frente logo depois de uma tecla: um Alt solto destrava (o truque clássico).
            keybd_event(0x12, 0, 0, IntPtr.Zero); keybd_event(0x12, 0, 2, IntPtr.Zero);
            if (!W.SetForegroundWindow(h)) W.SwitchToThisWindow(h, true);
        }
    }
}
