// Iniciar com o Windows: entradas na lista de inicialização do PRÓPRIO usuário (HKCU\...\Run, sem administrador).
// O Jarvis Desktop sobe com "--inicio": fica na bandeja ouvindo o "Jarvis", sem abrir a janela grande.
// A voz (servidor do VoiceStudio) o próprio Jarvis Desktop liga escondida. Liga e desliga pela bandeja.
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace JarvisDesktop
{
    static class Startup
    {
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", Me = "JarvisDesktop", Voice = "VoiceStudio (Jarvis)";
        public static string VoiceStudioExe
        {
            get { var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\VoiceStudio\VoiceStudio.exe"); return File.Exists(p) ? p : null; }
        }

        // A voz do Jarvis é do VoiceStudio. Basta o servidor dele (o mesmo que a janela do VoiceStudio liga por trás),
        // então o Jarvis liga só esse servidor, escondido, sem abrir a janela. Se ele fechar ou cair (falta de memória
        // derruba o motor), liga de novo. Com a janela do VoiceStudio aberta, quem cuida do servidor é ela.
        public const int VoicePort = 3900;
        static DateTime voiceStarted = DateTime.MinValue;
        public static bool VoiceUp()
        {
            try { using (var c = new System.Net.Sockets.TcpClient()) { var t = c.BeginConnect("127.0.0.1", VoicePort, null, null); return t.AsyncWaitHandle.WaitOne(500) && c.Connected; } }
            catch { return false; }
        }
        public static void EnsureVoiceStudio(string why)
        {
            if ((DateTime.Now - voiceStarted).TotalMinutes < 4) return;   // já ligando (o motor leva um tempo para subir)
            if (VoiceUp() || System.Diagnostics.Process.GetProcessesByName("VoiceStudio").Length > 0) return;
            string proj = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"VoiceStudio\runtime\project"),
                   py = Path.Combine(proj, @".venv\Scripts\python.exe"), uv = VoiceStudioExe == null ? null : Path.Combine(Path.GetDirectoryName(VoiceStudioExe), @"resources\tools\uv.exe");
            if (!File.Exists(py)) return;
            string log = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), @"logs\voicestudio.log");
            var psi = new System.Diagnostics.ProcessStartInfo("cmd.exe", "/c \"\"" + py + "\" -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port " + VoicePort + " > \"" + log + "\" 2>&1\"")
                { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = proj };
            // O mesmo ambiente que a janela do VoiceStudio monta para o servidor dela.
            var e = psi.EnvironmentVariables;
            e.Remove("PYTHONHOME"); e.Remove("PYTHONPATH");
            e["PYTHONUNBUFFERED"] = "1"; e["PYTHONUTF8"] = "1"; e["OMNIVOICE_PORT"] = VoicePort.ToString();
            e["TORCHDYNAMO_DISABLE"] = "1"; e["HF_HUB_DISABLE_SYMLINKS"] = "1"; e["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"; e["FOR_DISABLE_CONSOLE_CTRL_HANDLER"] = "1";
            if (uv != null && File.Exists(uv)) e["OMNIVOICE_BUNDLED_UV"] = uv;
            foreach (var k in new[] { "OMNIVOICE_POCKETTTS_24L", "HF_TOKEN" })   // ajustes do usuário (o modelo de 24 camadas da voz do Jarvis)
            { var v = Environment.GetEnvironmentVariable(k, EnvironmentVariableTarget.User); if (!string.IsNullOrEmpty(v)) e[k] = v; }
            try { using (System.Diagnostics.Process.Start(psi)) { } voiceStarted = DateTime.Now; Log.Write("voz: ligando o servidor do VoiceStudio em segundo plano (" + why + ")"); }
            catch (Exception ex) { Log.Write("não consegui ligar o VoiceStudio: " + ex.Message); }
        }

        // Já perguntamos se ele deve iniciar com o Windows? (fica no registro do próprio usuário, sobrevive a reinstalar)
        const string PrefKey = @"Software\JarvisDesktop";
        public static bool Asked
        {
            get { using (var k = Registry.CurrentUser.OpenSubKey(PrefKey)) return k != null && (k.GetValue("PerguntouInicio") as int? ?? 0) == 1; }
            set { using (var k = Registry.CurrentUser.CreateSubKey(PrefKey)) k.SetValue("PerguntouInicio", value ? 1 : 0, RegistryValueKind.DWord); }
        }

        // Primeira vez que o app abre: pergunta numa caixa no visual do Jarvis. Sim liga, "Agora não" deixa como está.
        public static void AskOnce(bool force = false)
        {
            if (!force && (Asked || Enabled)) { if (Enabled && !Asked) Asked = true; return; }
            bool yes;
            using (var f = new StartupAsk()) yes = f.ShowDialog() == DialogResult.Yes;
            Asked = true;
            if (yes) Set(true);
            Log.Write("pergunta de iniciar com o Windows: " + (yes ? "sim" : "agora não"));
        }

        public static bool Enabled
        {
            get { using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) { var v = k == null ? null : k.GetValue(Me) as string; return v != null && v.IndexOf(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) >= 0; } }
        }

        public static void Set(bool on)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (on)
                {
                    k.SetValue(Me, "\"" + Application.ExecutablePath + "\" --inicio");
                    k.DeleteValue(Voice, false);   // a voz sobe escondida pelo próprio Jarvis (antes abria a janela do VoiceStudio)
                }
                else { k.DeleteValue(Me, false); k.DeleteValue(Voice, false); }
            }
            Log.Write("iniciar com o Windows: " + (on ? "ligado" : "desligado"));
        }
    }

    // A caixa: escura, cantos arredondados, o círculo âmbar do Jarvis, dois botões. Fica por cima, no centro da tela.
    class StartupAsk : Form
    {
        static readonly Color Bg = Color.FromArgb(14, 15, 19), Line = Color.FromArgb(40, 43, 51), Acc = Color.FromArgb(242, 179, 61), Txt = Color.FromArgb(241, 239, 233), Mute = Color.FromArgb(163, 160, 154);
        Rectangle yesR, noR; int hover = -1;
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
        public StartupAsk()
        {
            FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen; ShowInTaskbar = true; TopMost = true;
            Text = "JARVIS"; BackColor = Bg; DoubleBuffered = true; KeyPreview = true; AutoScaleMode = AutoScaleMode.None;
            float s = DeviceDpi / 96f; Size = new Size((int)(460 * s), (int)(250 * s));
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Region = Region.FromHrgn(W.CreateRoundRectRgn(0, 0, Width + 1, Height + 1, (int)(22 * s), (int)(22 * s)));
            int bw = (int)(170 * s), bh = (int)(40 * s), by = Height - bh - (int)(26 * s);
            yesR = new Rectangle(Width - (int)(28 * s) - bw, by, bw, bh); noR = new Rectangle(yesR.Left - (int)(12 * s) - (int)(120 * s), by, (int)(120 * s), bh);
            MouseMove += (o, e) => { int h = yesR.Contains(e.Location) ? 0 : noR.Contains(e.Location) ? 1 : -1; if (h != hover) { hover = h; Cursor = h >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); } };
            MouseDown += (o, e) => { if (e.Button == MouseButtons.Left && hover < 0) { ReleaseCapture(); SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); } };   // arrastar pela caixa
            MouseUp += (o, e) => { if (yesR.Contains(e.Location)) { DialogResult = DialogResult.Yes; } else if (noR.Contains(e.Location)) { DialogResult = DialogResult.No; } };
            KeyDown += (o, e) => { if (e.KeyCode == Keys.Enter) DialogResult = DialogResult.Yes; else if (e.KeyCode == Keys.Escape) DialogResult = DialogResult.No; };
        }
        protected override void OnShown(EventArgs e) { base.OnShown(e); Activate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            float s = DeviceDpi / 96f;
            using (var p = new Pen(Line, 1.5f)) g.DrawPath(p, Round(new RectangleF(0.75f, 0.75f, Width - 1.5f, Height - 1.5f), 11 * s));
            using (var glow = new System.Drawing.Drawing2D.LinearGradientBrush(new Rectangle(0, 0, Width, 3), Color.FromArgb(0, Acc), Acc, 0f)) { var cb = new System.Drawing.Drawing2D.ColorBlend { Colors = new[] { Color.FromArgb(0, Acc), Acc, Color.FromArgb(0, Acc) }, Positions = new[] { 0f, .5f, 1f } }; glow.InterpolationColors = cb; g.FillRectangle(glow, 40 * s, 0, Width - 80 * s, 2 * s); }
            // círculo do Jarvis
            float cx = 50 * s, cy = 58 * s, r = 20 * s;
            for (int i = 0; i < 36; i++) { double a = i * Math.PI * 2 / 36; using (var p = new Pen(Color.FromArgb(200, Acc), 1.6f * s)) g.DrawLine(p, (float)(cx + Math.Cos(a) * r), (float)(cy + Math.Sin(a) * r), (float)(cx + Math.Cos(a) * (r + 5 * s)), (float)(cy + Math.Sin(a) * (r + 5 * s))); }
            using (var p = new Pen(Color.FromArgb(150, Acc), 1.4f * s)) g.DrawEllipse(p, cx - r * .55f, cy - r * .55f, r * 1.1f, r * 1.1f);
            using (var b = new SolidBrush(Acc)) g.FillEllipse(b, cx - 3.5f * s, cy - 3.5f * s, 7 * s, 7 * s);
            using (var f = new Font("Consolas", 8.5f * s / (DeviceDpi / 96f), FontStyle.Regular)) using (var b = new SolidBrush(Acc)) g.DrawString("J A R V I S", f, b, 88 * s, 36 * s);
            using (var f = new Font("Segoe UI Semibold", 15.5f, FontStyle.Bold)) using (var b = new SolidBrush(Txt)) g.DrawString("Iniciar junto com o Windows?", f, b, 86 * s, 52 * s);
            using (var f = new Font("Segoe UI", 10.5f)) using (var b = new SolidBrush(Mute))
                g.DrawString("Ele abre sozinho quando você liga o computador e fica quietinho na bandeja, pronto para ouvir \"Jarvis\". Dá para mudar depois no menu da bandeja.", f, b, new RectangleF(30 * s, 104 * s, Width - 60 * s, 60 * s));
            Button(g, noR, "Agora não", false, hover == 1, s); Button(g, yesR, "Sim, iniciar junto", true, hover == 0, s);
        }
        void Button(Graphics g, Rectangle r, string t, bool pri, bool hot, float s)
        {
            using (var path = Round(r, r.Height / 2f))
            {
                using (var b = new SolidBrush(pri ? (hot ? Color.FromArgb(255, 196, 92) : Acc) : (hot ? Color.FromArgb(32, 34, 40) : Color.FromArgb(22, 23, 28)))) g.FillPath(b, path);
                if (!pri) using (var p = new Pen(hot ? Mute : Line, 1.2f)) g.DrawPath(p, path);
            }
            using (var f = new Font("Segoe UI Semibold", 10.5f, FontStyle.Bold)) using (var b = new SolidBrush(pri ? Color.FromArgb(22, 18, 10) : Txt))
                g.DrawString(t, f, b, r, new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center });
        }
        static System.Drawing.Drawing2D.GraphicsPath Round(RectangleF r, float rad)
        {
            var p = new System.Drawing.Drawing2D.GraphicsPath(); float d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90); p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure(); return p;
        }
    }
}
