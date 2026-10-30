// Instalador do JARVIS para Windows (JarvisSetup.exe).
// O servidor monta o arquivo assim: [este programa][ZIP com o Jarvis][8 bytes: onde o ZIP começa]["JARVISZ1"].
// Ao abrir, o instalador lê o ZIP do próprio arquivo e:
//   - instala em %LOCALAPPDATA%\Programs\Jarvis (sem pedir administrador);
//   - preserva o que já é seu numa reinstalação (jarvis\data, jarvis\.env, mascote\config.json);
//   - cria atalhos na área de trabalho e no menu Iniciar;
//   - registra "Desinstalar" em Configurações > Apps (só para este usuário);
//   - avisa se o Node.js não estiver instalado.
// Desinstalar: JarvisSetup.exe /desinstalar (copiado para a pasta instalada).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace JarvisSetup
{
    static class Program
    {
        public const string Name = "JARVIS";
        public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Jarvis");
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\JarvisDesktop";

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            if (args.Any(a => a.Equals("/desinstalar", StringComparison.OrdinalIgnoreCase))) { Uninstall(); return; }
            // Silencioso: "/extrair <pasta>" só extrai o pacote (testes e quem prefere instalar à mão). Código de saída 0 = ok.
            if (args.Length == 2 && args[0].Equals("/extrair", StringComparison.OrdinalIgnoreCase))
            {
                var zip = Payload();
                if (zip == null) Environment.Exit(2);
                try { Extract(zip, args[1], (p, w) => { }); Environment.Exit(0); } catch { Environment.Exit(3); }
            }
            Application.Run(new SetupForm());
        }

        // O ZIP que o servidor anexou ao final deste .exe.
        public static byte[] Payload()
        {
            byte[] all = File.ReadAllBytes(Application.ExecutablePath);
            if (all.Length < 16 || Encoding.ASCII.GetString(all, all.Length - 8, 8) != "JARVISZ1") return null;
            long start = BitConverter.ToInt64(all, all.Length - 16);
            if (start <= 0 || start >= all.Length - 16) return null;
            var zip = new byte[all.Length - 16 - start];
            Array.Copy(all, start, zip, 0, zip.Length);
            return zip;
        }

        // Arquivos que são do usuário: numa reinstalação, nunca são substituídos.
        static bool Keep(string rel)
        {
            rel = rel.Replace('/', '\\').ToLowerInvariant();
            return rel.StartsWith("jarvis\\data\\") || rel == "jarvis\\.env" || rel == "mascote\\config.json";
        }

        public static void Install(byte[] zip, bool desktop, Action<int, string> progress)
        {
            Extract(zip, Dir, progress);
            InstallExtras(desktop, progress);
        }

        // Só extrai o pacote numa pasta (sem atalhos nem registro). Também é o modo "/extrair <pasta>".
        public static void Extract(byte[] zip, string dir, Action<int, string> progress)
        {
            Directory.CreateDirectory(dir);
            string root = Path.GetFullPath(dir).TrimEnd('\\') + "\\";
            using (var ms = new MemoryStream(zip))
            using (var za = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                var files = za.Entries.Where(e => !string.IsNullOrEmpty(e.Name)).ToList();
                for (int i = 0; i < files.Count; i++)
                {
                    var e = files[i];
                    string rel = e.FullName.StartsWith("Jarvis/") ? e.FullName.Substring(7) : e.FullName;
                    string dest = Path.GetFullPath(Path.Combine(dir, rel.Replace('/', '\\')));
                    if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;   // nada fora da pasta de instalação
                    if (Keep(rel) && File.Exists(dest)) continue;
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    progress(i * 90 / files.Count, rel);
                    e.ExtractToFile(dest, true);
                }
            }
        }

        static void InstallExtras(bool desktop, Action<int, string> progress)
        {
            // Cópia do instalador (só o programa, sem o pacote) para desinstalar depois.
            progress(92, "atalhos");
            byte[] self = File.ReadAllBytes(Application.ExecutablePath);
            long cut = self.Length;
            if (self.Length > 16 && Encoding.ASCII.GetString(self, self.Length - 8, 8) == "JARVISZ1") cut = BitConverter.ToInt64(self, self.Length - 16);
            var stub = new byte[cut]; Array.Copy(self, stub, cut);
            File.WriteAllBytes(Path.Combine(Dir, "Desinstalar.exe"), stub);

            string exe = Path.Combine(Dir, "mascote", "JarvisDesktop.exe");
            string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "JARVIS.lnk");
            Shortcut(startMenu, exe, Path.Combine(Dir, "mascote"));
            if (desktop) Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "JARVIS.lnk"), exe, Path.Combine(Dir, "mascote"));

            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", "JARVIS (assistente por voz)");
                k.SetValue("Publisher", "JARVIS");
                k.SetValue("DisplayIcon", exe);
                k.SetValue("InstallLocation", Dir);
                k.SetValue("UninstallString", "\"" + Path.Combine(Dir, "Desinstalar.exe") + "\" /desinstalar");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord); k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
            progress(100, "pronto");
        }

        // Atalho .lnk pelo Windows Script Host (vem com o Windows).
        static void Shortcut(string lnk, string target, string workDir)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            dynamic sh = Activator.CreateInstance(t);
            dynamic s = sh.CreateShortcut(lnk);
            s.TargetPath = target; s.WorkingDirectory = workDir; s.IconLocation = target + ",0";
            s.Description = "JARVIS: seu mordomo digital, por voz";
            s.Save();
        }

        public static bool NodeInstalled()
        {
            try
            {
                var p = Process.Start(new ProcessStartInfo("node", "--version") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true });
                string v = p.StandardOutput.ReadToEnd().Trim(); p.WaitForExit(5000);
                return v.StartsWith("v");
            }
            catch { return false; }
        }

        // O servidor do Jarvis (node server.js) roda da pasta instalada e segura os arquivos: fecha antes de apagar/atualizar.
        static void KillServer()
        {
            try
            {
                using (var q = new System.Management.ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'"))
                    foreach (System.Management.ManagementObject o in q.Get())
                    {
                        var cmd = Convert.ToString(o["CommandLine"]) ?? "";
                        if (cmd.IndexOf("server.js", StringComparison.OrdinalIgnoreCase) >= 0 && cmd.IndexOf(Dir, StringComparison.OrdinalIgnoreCase) >= 0)
                            try { var p = Process.GetProcessById(Convert.ToInt32(o["ProcessId"])); p.Kill(); p.WaitForExit(3000); } catch { }
                    }
            }
            catch { }
        }
        public static void KillServerPublic() { KillServer(); }

        // Chave do Gemini digitada no instalador: vai para jarvis\.env DESTE computador (nunca sai dele).
        public static void SaveGeminiKey(string key)
        {
            key = (key ?? "").Trim();
            if (key.Length < 20 || key.Length > 200 || key.IndexOfAny(new[] { '\r', '\n', ' ', '"' }) >= 0) return;
            string env = Path.Combine(Dir, "jarvis", ".env");
            var lines = File.Exists(env) ? File.ReadAllLines(env).ToList() : new System.Collections.Generic.List<string> { "# Chaves do JARVIS: ficam só neste computador." };
            int i = lines.FindIndex(l => l.TrimStart().StartsWith("GEMINI_API_KEY="));
            if (i >= 0) lines[i] = "GEMINI_API_KEY=" + key; else lines.Add("GEMINI_API_KEY=" + key);
            File.WriteAllLines(env, lines);
        }

        static void Uninstall()
        {
            if (MessageBox.Show("Remover o JARVIS deste computador?\n\nSeus dados (memória, chaves e contas em jarvis\\data) também serão apagados.", "Desinstalar JARVIS",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            foreach (var p in Process.GetProcessesByName("JarvisDesktop")) { try { p.Kill(); p.WaitForExit(3000); } catch { } }
            KillServer();
            // "Iniciar com o Windows" e as preferências do app: sem isso, o Windows tentaria abrir um programa que não existe mais.
            try { using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) if (k != null) { k.DeleteValue("JarvisDesktop", false); k.DeleteValue("VoiceStudio (Jarvis)", false); } } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\JarvisDesktop", false); } catch { }
            foreach (var lnk in new[] { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "JARVIS.lnk"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "JARVIS.lnk") })
                try { File.Delete(lnk); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
            // Este programa está rodando de dentro da pasta: apaga tudo depois que ele fechar.
            Process.Start(new ProcessStartInfo("cmd.exe", "/c timeout /t 2 /nobreak >nul & rmdir /s /q \"" + Dir + "\"") { CreateNoWindow = true, UseShellExecute = false });
            MessageBox.Show("O JARVIS foi removido. Até a próxima, senhor.", "Desinstalar JARVIS", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    class SetupForm : Form
    {
        readonly CheckBox desk = new CheckBox(), open = new CheckBox();
        readonly TextBox key = new TextBox();
        [System.Runtime.InteropServices.DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);
        readonly ProgressBar bar = new ProgressBar();
        readonly Label status = new Label();
        readonly Button go = new Button();
        bool done;
        static readonly Color Bg = Color.FromArgb(11, 12, 15), Fg = Color.FromArgb(241, 239, 233), Mute = Color.FromArgb(163, 160, 154), Acc = Color.FromArgb(242, 179, 61);

        public SetupForm()
        {
            Text = "Instalar JARVIS"; ClientSize = new Size(460, 372); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen; BackColor = Bg; ForeColor = Fg; Font = new Font("Segoe UI", 10f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            HandleCreated += (o, e) => { try { int on = 1; DwmSetWindowAttribute(Handle, 20, ref on, 4); } catch { } };   // barra de título escura, como o resto
            var title = new Label { Text = "JARVIS", Font = new Font("Segoe UI", 22f, FontStyle.Bold), ForeColor = Acc, AutoSize = true, Location = new Point(24, 18) };
            var sub = new Label { Text = "Seu mordomo digital, por voz. Com o Jarvis Code na sua tela.", ForeColor = Mute, AutoSize = true, Location = new Point(27, 62) };
            var where = new Label { Text = "Instalar em: " + Program.Dir, ForeColor = Mute, Font = new Font("Segoe UI", 8.5f), AutoSize = false, Size = new Size(412, 34), Location = new Point(27, 92) };
            desk.Text = "Criar atalho na área de trabalho"; desk.Checked = true; desk.AutoSize = true; desk.Location = new Point(27, 130);
            open.Text = "Abrir o JARVIS ao terminar"; open.Checked = true; open.AutoSize = true; open.Location = new Point(27, 156);
            var keyL = new Label { Text = "Chave do Gemini (opcional, dá para pôr depois em jarvis\\.env)", ForeColor = Mute, Font = new Font("Segoe UI", 8.5f), AutoSize = true, Location = new Point(27, 190) };
            key.Location = new Point(27, 210); key.Size = new Size(300, 26); key.UseSystemPasswordChar = true; key.BackColor = Color.FromArgb(22, 23, 28); key.ForeColor = Fg; key.BorderStyle = BorderStyle.FixedSingle;
            var get = new LinkLabel { Text = "Pegar uma grátis", AutoSize = true, Location = new Point(336, 213), LinkColor = Acc, ActiveLinkColor = Fg };
            get.LinkClicked += (s, e) => { try { Process.Start("https://aistudio.google.com/apikey"); } catch { } };
            bar.Location = new Point(27, 262); bar.Size = new Size(406, 10); bar.Visible = false;
            status.Location = new Point(27, 278); status.Size = new Size(406, 36); status.ForeColor = Mute; status.Font = new Font("Segoe UI", 8.5f);
            go.Text = "Instalar"; go.Size = new Size(130, 36); go.Location = new Point(303, 320); go.FlatStyle = FlatStyle.Flat; go.BackColor = Acc; go.ForeColor = Color.FromArgb(22, 18, 10);
            go.Font = new Font("Segoe UI", 10f, FontStyle.Bold); go.FlatAppearance.BorderSize = 0; go.Click += (s, e) => Run();
            Controls.AddRange(new Control[] { title, sub, where, desk, open, keyL, key, get, bar, status, go });
            AcceptButton = go;
        }

        void Run()
        {
            if (done) { Close(); return; }
            var zip = Program.Payload();
            if (zip == null) { MessageBox.Show("Este instalador está incompleto. Baixe de novo pelo site do JARVIS.", "Instalar JARVIS", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
            foreach (var p in Process.GetProcessesByName("JarvisDesktop")) { try { p.Kill(); p.WaitForExit(3000); } catch { } }   // atualização: fecha o antigo
            Program.KillServerPublic();
            go.Enabled = false; desk.Enabled = false; open.Enabled = false; key.Enabled = false; bar.Visible = true;
            try
            {
                Program.Install(zip, desk.Checked, (pct, what) => { bar.Value = Math.Min(100, pct); status.Text = pct < 92 ? "Copiando " + what : "Criando atalhos…"; Application.DoEvents(); });
            }
            catch (Exception ex) { status.Text = "Falhou: " + ex.Message; go.Enabled = true; return; }
            try { Program.SaveGeminiKey(key.Text); } catch { /* a chave pode ser posta depois no .env */ }
            bool node = Program.NodeInstalled();
            if (!node && MessageBox.Show("O JARVIS precisa do Node.js (versão 20.6 ou mais nova), e ele não está instalado.\n\nAbrir o site do Node.js para baixar a versão LTS?", "Falta o Node.js",
                MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                try { Process.Start("https://nodejs.org/pt"); } catch { }
            status.Text = node ? "Instalado. Use o atalho JARVIS na área de trabalho." : "Instalado. Depois de instalar o Node.js, abra o atalho JARVIS.";
            go.Text = "Concluir"; go.Enabled = true; done = true;
            if (open.Checked && node) try { Process.Start(new ProcessStartInfo(Path.Combine(Program.Dir, "mascote", "JarvisDesktop.exe")) { WorkingDirectory = Path.Combine(Program.Dir, "mascote") }); } catch { }
        }
    }
}
