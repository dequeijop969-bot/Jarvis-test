// JarvisDesktop.exe: ícone na bandeja + mascote + (opcional) servidor do Jarvis e a janela do site.
// Opções de linha de comando (úteis para testar):
//   --sem-jarvis          não conecta nem inicia o Jarvis (modo de teste puro)
//   --teste=notepad       dispara o fluxo de exemplo ao abrir (pensar -> andar -> abrir -> pular)
//   --teste=vscode        abre o VS Code com um HTML de exemplo e o mascote "digita" com o notebook
//   --sair-apos=30        fecha sozinho depois de N segundos
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Threading;
using System.Windows.Forms;
using FormsTimer = System.Windows.Forms.Timer;

namespace JarvisDesktop
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool first;
            using (var mx = new Mutex(true, "Local\\JarvisDesktopMascote", out first))
            {
                if (!first) { MessageBox.Show("O Jarvis Desktop já está aberto (veja o ícone perto do relógio).", "Jarvis"); return; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += (s, e) => Log.Write("ERRO: " + e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => Log.Write("ERRO FATAL: " + e.ExceptionObject);
                Log.Write("---- iniciando (" + string.Join(" ", args) + ")");
                Application.Run(new TrayApp(args));
            }
        }
    }

    class TrayApp : ApplicationContext
    {
        readonly Config cfg; readonly Overlay ov; readonly Mascot m; readonly NotifyIcon tray; JarvisClient jc;
        readonly ToolStripMenuItem miShow, miStatus, miTalkKey, miWake, miStartup; readonly bool semJarvis, semJanela;
        // Modo V: "Jarvis" (escuta local) -> escuro em V no topo + janela flutuante no meio dele, ouvindo.
        readonly VOverlay vov = new VOverlay(); readonly HashSet<string> vSeen = new HashSet<string>(); Wake wake; bool vOn; DateTime vLast; string vLastState = "";

        public TrayApp(string[] args)
        {
            cfg = Config.Load();
            VOverlay.InPhotos = args.Contains("--v-na-foto");
            semJarvis = args.Contains("--sem-jarvis"); semJanela = args.Contains("--sem-janela") || args.Contains("--inicio");   // --inicio: subiu com o Windows
            SpriteSet sp;
            try { sp = SpriteSet.Load(cfg.Full(cfg.pastaSprites)); }
            catch (Exception e) { MessageBox.Show(e.Message + "\n\nConfira \"pastaSprites\" no config.json.", "Jarvis"); Environment.Exit(1); return; }

            ov = new Overlay(); ov.Show();
            m = new Mascot(cfg, ov, sp);
            // Roupa de carteiro (pasta sprites-carteiro ao lado dos sprites normais): sem ela, entrega com a roupa de sempre.
            try { var pc = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(cfg.Full(cfg.pastaSprites).TrimEnd('\\', '/')), "sprites-carteiro"); if (System.IO.Directory.Exists(pc)) m.PostSkin = SpriteSet.Load(pc); }
            catch (Exception ex) { Log.Write("roupa de carteiro: " + ex.Message); }
            m.Vanished += () => { if (miShow != null) miShow.Checked = false; };   // foi embora sozinho depois da tarefa

            var menu = new ContextMenuStrip();
            var miOpen = new ToolStripMenuItem("Abrir JARVIS", null, (s, e) => ServerHost.OpenApp(cfg)) { Font = new Font(SystemFonts.MenuFont, FontStyle.Bold) };
            miShow = new ToolStripMenuItem("Mostrar o Jarvis Code", null, (s, e) => { miShow.Checked = !miShow.Checked; m.AutoHide = false; m.SetVisible(miShow.Checked); }) { Checked = true };
            var miTest = new ToolStripMenuItem("Modo de teste");
            miTest.DropDownItems.Add("Abrir o Bloco de Notas  (" + cfg.atalhoTeste + ")", null, (s, e) => Test("notepad", null));
            miTest.DropDownItems.Add("Abrir a Calculadora", null, (s, e) => Test("calc", null));
            miTest.DropDownItems.Add("Abrir google.com no navegador", null, (s, e) => Test("navegador", "https://www.google.com"));
            miTest.DropDownItems.Add("Escrever um HTML no VS Code (modo Code)", null, (s, e) => TestWrite());
            miTest.DropDownItems.Add("Só pensar (3 s)", null, (s, e) => { Fire("pensando_inicio", null); After(3000, () => Fire("concluido", null)); });
            miTest.DropDownItems.Add("Mexer no notebook (ocioso)", null, (s, e) => m.IdleNow(false));
            miTest.DropDownItems.Add("Passear (ocioso)", null, (s, e) => m.IdleNow(true));
            miTest.DropDownItems.Add("Pensar e dar erro", null, (s, e) => { Fire("pensando_inicio", null); After(2000, () => Fire("erro", new Dictionary<string, object> { { "mensagem", "teste" } })); });
            miStatus = new ToolStripMenuItem(semJarvis ? "Jarvis: modo de teste (sem conexão)" : "Jarvis: conectando…") { Enabled = false };
            miTalkKey = new ToolStripMenuItem("Atalho de falar (" + cfg.atalhoFalar + ")", null, (s, e) => SetTalkKey(!miTalkKey.Checked)) { Enabled = !semJarvis };
            miWake = new ToolStripMenuItem("Ouvir \"Jarvis\" (escuta local)", null, (s, e) => SetWake(!miWake.Checked)) { Enabled = !semJarvis };
            miStartup = new ToolStripMenuItem("Iniciar com o Windows", null, (s, e) => { try { Startup.Set(!miStartup.Checked); miStartup.Checked = Startup.Enabled; } catch (Exception x) { Log.Write("inicialização: " + x.Message); } }) { Checked = Startup.Enabled };
            // Menu da bandeja: o que se usa no dia a dia em cima; testes e manutenção em "Avançado".
            var miCall = new ToolStripMenuItem("Chamar o Jarvis agora", null, (s, e) => { if (!vOn) OnWake(); }) { Enabled = !semJarvis };
            var miMail = new ToolStripMenuItem("Caixa de correio", null, (s, e) => OnMail(new Dictionary<string, object> { { "abrir", true } })) { Enabled = !semJarvis };
            var miAdv = new ToolStripMenuItem("Avançado");
            miAdv.DropDownItems.Add(miTest);
            miAdv.DropDownItems.Add("Trazer o Jarvis Code de volta ao canto", null, (s, e) => m.Home());
            miAdv.DropDownItems.Add("Abrir config.json", null, (s, e) => Shell(Config.FilePath));
            miAdv.DropDownItems.Add("Abrir pasta de logs", null, (s, e) => Shell(System.IO.Path.Combine(Config.Dir, "logs")));
            menu.Items.Add(miOpen); menu.Items.Add(miCall); menu.Items.Add(miMail);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miWake); menu.Items.Add(miTalkKey); menu.Items.Add(miShow); menu.Items.Add(miStartup);
            menu.Items.Add(new ToolStripSeparator()); menu.Items.Add(miStatus); menu.Items.Add(miAdv);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair", null, (s, e) => Quit());

            tray = new NotifyIcon { Icon = MakeIcon(sp["parado"].Frames[0]), Text = "Jarvis", ContextMenuStrip = menu, Visible = true };
            tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) ServerHost.OpenApp(cfg); };
            ov.RightClick += () => menu.Show(Cursor.Position);

            uint mods, vk;
            if (ParseHotkey(cfg.atalhoTeste, out mods, out vk) && W.RegisterHotKey(ov.Handle, 1, mods | W.MOD_NOREPEAT, vk)) ov.Hotkey += id => { if (id == 1) Test("notepad", null); };
            else Log.Write("atalho de teste indisponível: " + cfg.atalhoTeste);
            // Atalho de falar: o mesmo que dizer "Jarvis" (o V aparece e ouve). Com o V na tela, fecha.
            // Se for uma tecla sozinha (ex.: Tab), ela fica só para o Jarvis em todos os programas enquanto ligado (pausa pela bandeja).
            ov.Hotkey += id => { if (id != 2) return; if (vOn) { ThreadPool.QueueUserWorkItem(_ => Floating.TalkNow(cfg, "parar")); EndV(); } else OnWake(); };
            if (!semJarvis) SetTalkKey(true);
            Floating.Opacity = cfg.opacidadeFlutuante ?? 0.88;
            // Encaixa a página do navegador na moldura flutuante quando ela aparece (e esconde a moldura se o navegador fechar).
            floatTimer = new FormsTimer { Interval = 300 }; floatTimer.Tick += (s, e) => { Floating.Tick(); ServerHost.StyleWindows(); }; if (!semJarvis) floatTimer.Start();

            if (!semJarvis)
            {
                // Começa com o Jarvis Code guardado: ele entra em cena com o modo flutuante (ou quando o modo Code pede uma ação).
                miShow.Checked = false; m.SetVisible(false);
                // "janela" vem da página flutuante (crescer para os slides / voltar ao compacto); o resto é do mascote.
                jc = new JarvisClient(cfg, ov, (type, d) =>
                {
                    object v;
                    if (type == "abrir_completo") ServerHost.OpenApp(cfg);
                    else if (type == "janela") Floating.SetBig(d != null && d.TryGetValue("grande", out v) && v is bool && (bool)v);
                    else if (type == "correio") OnMail(d);
                    else if (type == "focar")
                    {   // traz um app conhecido para a frente (o Spotify, antes de o Jarvis Code dar o play): só nomes da lista
                        object pv; string proc = d != null && d.TryGetValue("proc", out pv) ? Convert.ToString(pv) : "";
                        if (new[] { "Spotify" }.Contains(proc))
                        {
                            var w = Desktop.List().FirstOrDefault(x => x.Proc.Equals(proc, StringComparison.OrdinalIgnoreCase) && x.Title.Length > 0);
                            if (w != null) { Desktop.BringToFront(w.H); Log.Write("janela para a frente: " + proc); } else Log.Write("não achei a janela do " + proc);
                        }
                    }
                    else if (type == "conversa") OnConversation(d != null && d.TryGetValue("ativo", out v) && v is bool && (bool)v);
                    else if (type == "v")
                    {
                        object k0; if (vOn && d != null && d.TryGetValue("k", out k0) && Convert.ToString(k0) == "tudo") { vov.PageMode = true; Floating.ShowInV(); }   // a página entrou no layout do V: ela aparece no escuro
                        if (vOn && d != null && d.TryGetValue("k", out k0) && Convert.ToString(k0) == "estado") { object mm; d.TryGetValue("m", out mm); if (Convert.ToString(mm) != vLastState) { vLastState = Convert.ToString(mm); Log.Write("modo V: página " + vLastState); } }
                        vov.Feed(d); object kk; if (d != null && d.TryGetValue("k", out kk) && vSeen.Add(Convert.ToString(kk))) Log.Write("modo V: recebendo " + kk);
                    }
                    else
                    {
                        // Pedido de ação com o Jarvis Code guardado (modo Code na página principal): ele aparece para fazer.
                        if (type == "acao" && !miShow.Checked) { miShow.Checked = true; m.SetVisible(true); m.AutoHide = true; }   // terminou: ele vai embora sozinho
                        m.OnEvent(type, d);
                    }
                });
                jc.Outdated += () =>
                {
                    miStatus.Text = "Jarvis: versão antiga no ar. Reinicie o servidor";
                    tray.ShowBalloonTip(10000, "Jarvis", "O servidor do Jarvis aberto é de uma versão antiga e não conversa com o mascote. Feche-o (Ctrl+C no terminal) e abra este app de novo: ele sobe a versão nova.", ToolTipIcon.Warning);
                };
                jc.StatusChanged += on => { miStatus.Text = on ? "Jarvis: conectado" : "Jarvis: desconectado (tentando…)"; tray.Text = on ? "Jarvis · conectado" : "Jarvis · desconectado"; };
                m.Report = jc.Report; m.SendCapture = jc.SendCapture;
                jc.Start();
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    string st = ServerHost.EnsureServer(cfg);
                    Log.Write("servidor: " + st);
                    try
                    {
                        ov.BeginInvoke(new Action(() =>
                        {
                            // Ao abrir: primeiro a página principal do Jarvis. O modo flutuante (janela transparente + Jarvis Code) liga por lá.
                            if (st == "ok") { if (cfg.abrirAppAoIniciar && !semJanela) ServerHost.OpenApp(cfg); }
                            else tray.ShowBalloonTip(6000, "Jarvis", "Servidor: " + st, ToolTipIcon.Warning);
                        }));
                    }
                    catch { }
                });
            }
            else m.Report = (id, status, d) => Log.Write("resultado " + id + ": " + status + " " + d);

            // Modo V: arquivos soltos no escuro vão para o Jarvis; um clique no escuro encerra.
            vov.FilesDropped += paths => { foreach (var p in paths.Take(8)) vov.AddFileName(System.IO.Path.GetFileName(p)); vLast = DateTime.Now; ThreadPool.QueueUserWorkItem(_ => UploadFiles(paths)); };
            vov.Dismissed += () => { ThreadPool.QueueUserWorkItem(_ => Floating.TalkNow(cfg, "parar")); EndV(); };

            // Escuta passiva do "Jarvis" (Vosk, local). Liga sozinha se os arquivos estiverem em mascote\vosk.
            string vd = System.IO.Path.Combine(Application.StartupPath, "vosk");
            if (!Wake.Available(vd)) { miWake.Enabled = false; miWake.Text += ": arquivos não encontrados"; }
            else if (!semJarvis && cfg.escutaJarvis != false) SetWake(true);
            var escuta = args.FirstOrDefault(a => a.StartsWith("--teste-escuta="));   // --teste-escuta=arquivo.raw: conta os "Jarvis" ouvidos e sai
            if (escuta != null) { Log.Write("teste de escuta: " + Wake.TestFile(vd, escuta.Substring(15)) + " chamada(s) em " + escuta.Substring(15)); }
            var foto = args.FirstOrDefault(a => a.StartsWith("--teste-v-png="));   // --teste-v-png=arquivo.png[,fase]: desenha o V de exemplo e salva
            if (foto != null) { var pp = foto.Substring(14).Split(','); VOverlay.SnapshotTest(pp[0], pp.Length > 1 ? pp[1] : "falando"); Log.Write("V salvo em " + pp[0]); }
            var testeV = args.FirstOrDefault(a => a == "--teste-v");    // --teste-v: simula um "Jarvis" 1,5 s depois de abrir
            if (testeV != null) After(1500, OnWake);
            // Mantém a voz no ar: confere o VoiceStudio ao abrir (dá tempo do Windows abrir o dele) e a cada 3 min.
            if (!semJarvis && cfg.manterVoz != false)
            {
                After(4000, () => ThreadPool.QueueUserWorkItem(_ => Startup.EnsureVoiceStudio("início")));
                if (Startup.Enabled) Startup.Set(true);   // tira a entrada antiga que abria a janela do VoiceStudio no login
                var vsTimer = new FormsTimer { Interval = 180000 }; vsTimer.Tick += (s, e) => ThreadPool.QueueUserWorkItem(_ => Startup.EnsureVoiceStudio("conferência")); vsTimer.Start();
            }
            // Primeira vez: pergunta se ele deve iniciar com o Windows (uma vez só; depois, pelo menu da bandeja)
            if (!args.Any(a => a.StartsWith("--teste"))) After(3500, () => { try { Startup.AskOnce(); miStartup.Checked = Startup.Enabled; } catch (Exception x) { Log.Write("pergunta de inicialização: " + x.Message); } });
            // --teste-pergunta-inicio: mostra a caixa de "iniciar com o Windows" (não grava nada)
            if (args.Contains("--teste-pergunta-inicio")) After(1500, () => { using (var f = new StartupAsk()) Log.Write("teste da pergunta: " + f.ShowDialog()); });
            // --teste-correio: abre a caixa de correio e o Jarvis Code entrega (como "me manda o arquivo")
            if (args.Contains("--teste-correio")) After(2500, () => OnMail(new Dictionary<string, object> { { "abrir", true }, { "entregar", "teste" } }));
            // --teste-sumir: aparece como se viesse fazer uma tarefa, tira o chapéu e vai embora sozinho
            if (args.Contains("--teste-sumir")) After(1500, () => { miShow.Checked = true; m.SetVisible(true); m.AutoHide = true; m.Enqueue(new GestureStep("cumprimentar", 2.0)); });
            var testeArq = args.FirstOrDefault(a => a.StartsWith("--teste-arquivo="));   // --teste-arquivo=a.png;b.js: "solta" no V 5 s depois de abrir
            if (testeArq != null) After(5000, () => { var fs = testeArq.Substring(16).Split(';'); foreach (var f in fs) vov.AddFileName(System.IO.Path.GetFileName(f)); ThreadPool.QueueUserWorkItem(_ => UploadFiles(fs)); });

            var teste = args.FirstOrDefault(a => a.StartsWith("--teste="));
            if (teste == "--teste=vscode") After(semJarvis ? 800 : 8000, TestWrite);   // com o Jarvis, espera a janela flutuante abrir
            else if (teste != null) After(800, () => Test(teste.Substring(8), teste.Substring(8) == "navegador" ? "https://www.google.com" : null));
            // --teste-arrastar=4000: aos 4 s simula um arrasto (cancela a ação em andamento) e solta 0,6 s depois.
            var drag = args.FirstOrDefault(a => a.StartsWith("--teste-arrastar="));
            int dms; if (drag != null && int.TryParse(drag.Substring(17), out dms)) After(dms, () => { m.SimulateDrag(-120, -200); After(600, m.SimulateRelease); });
            // --teste-ocioso=notebook|passeio: dispara o ocioso 1 s depois de abrir.
            var ocioso = args.FirstOrDefault(a => a.StartsWith("--teste-ocioso="));
            if (ocioso != null) After(1000, () => m.IdleNow(ocioso.EndsWith("passeio")));
            var sair = args.FirstOrDefault(a => a.StartsWith("--sair-apos="));
            int secs; if (sair != null && int.TryParse(sair.Substring(12), out secs)) After(secs * 1000, Quit);
        }

        FormsTimer floatTimer;
        void SetTalkKey(bool on)
        {
            uint mods, vk;
            W.UnregisterHotKey(ov.Handle, 2);
            bool ok = on && ParseHotkey(cfg.atalhoFalar, out mods, out vk, true) && W.RegisterHotKey(ov.Handle, 2, mods | W.MOD_NOREPEAT, vk);
            if (on && !ok) Log.Write("atalho de falar indisponível: " + cfg.atalhoFalar);
            miTalkKey.Checked = ok;
            miTalkKey.Text = "Atalho de falar (" + cfg.atalhoFalar + ")" + (on && !ok ? ": em uso por outro programa" : "");
        }
        void SetWake(bool on)
        {
            string vd = System.IO.Path.Combine(Application.StartupPath, "vosk");
            if (on && wake == null && Wake.Available(vd))
            {
                wake = new Wake(vd);
                wake.Heard += () => { try { ov.BeginInvoke(new Action(OnWake)); } catch { } };
                wake.Start();
            }
            if (wake != null) wake.Paused = !on || vOn;
            miWake.Checked = on && wake != null;
            Log.Write("escuta do \"Jarvis\": " + (miWake.Checked ? "ligada" : "desligada"));
        }

        // Correio: abre a janela da caixa de correio; se for uma entrega, o Jarvis Code vai de carteiro até ela.
        void OnMail(Dictionary<string, object> d)
        {
            object e; string id = d != null && d.TryGetValue("id", out e) ? Convert.ToString(e) : null;
            bool entrega = d != null && d.ContainsKey("entregar");
            if (semJarvis) return;
            // O correio é um pop-up no V: se o V não está na tela, ele aparece; quando a página estiver no V, abre o pop-up.
            bool was = vOn;
            if (!vOn) OnWake();
            if (was) ThreadPool.QueueUserWorkItem(_ => Floating.TalkNow(cfg, "correio"));   // V já na tela (ex.: pela bandeja): só abre o pop-up
            else ThreadPool.QueueUserWorkItem(_ => { for (int i = 0; i < 16 && vOn; i++) { if (vActive) { Thread.Sleep(600); Floating.TalkNow(cfg, "correio"); break; } Thread.Sleep(700); } });
            if (!entrega) return;
            if (!miShow.Checked) { miShow.Checked = true; m.SetVisible(true); m.AutoHide = true; }   // veio só para entregar: depois vai embora
            m.Deliver(null);   // vai até embaixo do V (o meio da tela) e entrega
        }

        // Ouviu "Jarvis": escurece o topo em V, sobe a janela flutuante para o meio dele e começa a ouvir o pedido.
        // A escuta local fica pausada até a conversa acabar (não ouve a própria voz do Jarvis).
        void OnWake()
        {
            if (vOn) return;
            vOn = true; vLast = DateTime.Now;
            if (wake != null) wake.Paused = true;
            vov.ShowV();
            Floating.Top = true;
            if (cfg.manterVoz != false) ThreadPool.QueueUserWorkItem(_ => Startup.EnsureVoiceStudio("chamada do Jarvis"));
            if (!Floating.IsOpen) Floating.Open(cfg);
            Log.Write("modo V: ligado");
            // A página pode levar uns segundos para abrir e conectar: insiste a cada segundo até ela avisar que está ouvindo.
            ThreadPool.QueueUserWorkItem(_ =>
            {
                for (int i = 0; i < 12 && vOn && !vActive; i++) { Floating.TalkNow(cfg, "acordar"); Thread.Sleep(1000); }
                if (vOn && !vActive) Log.Write("modo V: a janela flutuante não começou a ouvir");
            });
            WatchV();
        }
        // A página avisa quando está ouvindo/pensando/falando (ativo) e quando volta a ficar parada.
        void OnConversation(bool ativo)
        {
            if (!vOn) return;
            vLast = DateTime.Now; vActive = ativo;
        }
        bool vActive;
        // Termina o modo V quando a conversa fica parada por 2 s (ou ninguém falou nada em 15 s).
        void WatchV()
        {
            After(500, () =>
            {
                if (!vOn) return;
                double idle = (DateTime.Now - vLast).TotalSeconds;
                if (!vActive && idle > (vEverActive ? 2 : 15)) { EndV(); return; }
                if (vActive) vEverActive = true;
                WatchV();
            });
        }
        bool vEverActive;
        void EndV()
        {
            vOn = false; vActive = false; vEverActive = false;
            vov.HideV();
            // Sem modo flutuante: a página que serve o V fecha junto (abre de novo, escondida, no próximo "Jarvis").
            Floating.Close();
            Floating.Top = false;
            Log.Write("modo V: desligado");
            After(1200, () => { if (wake != null && miWake.Checked && !vOn) wake.Paused = false; });
        }

        // Arquivo solto no V: imagem vira JPEG de até 1600 px; texto vai como está (até 4 MB). Depois a janela flutuante
        // põe na fila do próximo pedido (mesmo caminho de arrastar para a página).
        void UploadFiles(string[] paths)
        {
            foreach (var path in paths.Take(8))
            {
                string name = System.IO.Path.GetFileName(path);
                try
                {
                    var fi = new System.IO.FileInfo(path);
                    if (!fi.Exists || fi.Length > (fi.Extension.ToLowerInvariant() == ".pdf" ? 10000000 : 4000000)) { Log.Write("arquivo no V: " + name + " grande demais ou sumiu"); continue; }
                    string ext = fi.Extension.ToLowerInvariant(), data, type;
                    if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".bmp" || ext == ".gif")
                    {
                        using (var img = Image.FromFile(path))
                        {
                            double k = Math.Min(1.0, 1600.0 / Math.Max(img.Width, img.Height));
                            using (var b = new Bitmap(Math.Max(1, (int)(img.Width * k)), Math.Max(1, (int)(img.Height * k))))
                            using (var ms = new System.IO.MemoryStream())
                            {
                                using (var g = Graphics.FromImage(b)) { g.Clear(Color.White); g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(img, 0, 0, b.Width, b.Height); }
                                var enc = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
                                var ps = new System.Drawing.Imaging.EncoderParameters(1); ps.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
                                b.Save(ms, enc, ps);
                                data = "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray()); type = "image/jpeg";
                            }
                        }
                    }
                    else if (ext == ".pdf") { data = "data:application/pdf;base64," + Convert.ToBase64String(System.IO.File.ReadAllBytes(path)); type = "application/pdf"; }
                    else { data = "data:text/plain;base64," + Convert.ToBase64String(System.IO.File.ReadAllBytes(path)); type = "text/plain"; }
                    var up = Post("/api/files", new Dictionary<string, object> { { "name", name }, { "type", type }, { "data", data } });
                    object id, kind;
                    if (up == null || !up.TryGetValue("id", out id)) { Log.Write("arquivo no V: o Jarvis recusou " + name + (up != null && up.ContainsKey("error") ? ": " + up["error"] : "")); continue; }
                    up.TryGetValue("kind", out kind);
                    // A janela flutuante pode estar abrindo ainda: insiste até ela receber (até ~6 s).
                    for (int i = 0; i < 12; i++) { var ok = Post("/api/ui/arquivo", new Dictionary<string, object> { { "id", id }, { "name", name }, { "kind", kind } }); object w; if (ok != null && ok.TryGetValue("windows", out w) && Convert.ToInt32(w) > 0) break; Thread.Sleep(500); }
                    Log.Write("arquivo no V: " + name + " enviado");
                }
                catch (Exception e) { Log.Write("arquivo no V: " + name + ": " + e.Message); }
            }
        }
        Dictionary<string, object> Post(string path, Dictionary<string, object> body)
        {
            var js = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = 16000000 };
            var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(cfg.ApiBase + path);
            req.Method = "POST"; req.ContentType = "application/json"; req.Headers["x-jarvis"] = "1"; req.Proxy = null; req.Timeout = 20000;
            var bytes = System.Text.Encoding.UTF8.GetBytes(js.Serialize(body));
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            try
            {
                using (var resp = req.GetResponse()) using (var rd = new System.IO.StreamReader(resp.GetResponseStream(), System.Text.Encoding.UTF8))
                    return js.DeserializeObject(rd.ReadToEnd()) as Dictionary<string, object>;
            }
            catch (System.Net.WebException e)
            {
                if (e.Response == null) return null;
                using (var rd = new System.IO.StreamReader(e.Response.GetResponseStream(), System.Text.Encoding.UTF8)) return js.DeserializeObject(rd.ReadToEnd()) as Dictionary<string, object>;
            }
        }

        // Fluxo de exemplo sem o Jarvis: pensa 1,5 s e recebe a ação, igual viria do Jarvis.
        void Test(string alvo, string url)
        {
            Fire("pensando_inicio", null);
            After(1500, () =>
            {
                var d = new Dictionary<string, object> { { "id", "teste-" + DateTime.Now.Ticks }, { "acao", url == null ? "abrir_app" : "abrir_url" }, { "alvo", alvo } };
                if (url != null) d["url"] = url;
                Fire("acao", d); Fire("concluido", null);
            });
        }
        // Igual ao que o Jarvis manda no modo Code ("abre o VS Code e cria um html"), com um HTML pronto no lugar da IA.
        void TestWrite()
        {
            string file = System.IO.Path.Combine(cfg.PastaCodigo, "teste-mascote-" + DateTime.Now.ToString("HHmmss") + ".html");
            const string html = @"<!doctype html>
<html lang=""pt-BR"">
<head>
  <meta charset=""utf-8"">
  <meta name=""viewport"" content=""width=device-width, initial-scale=1"">
  <title>Olá do Jarvis</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #10131a; color: #f4f1ea; }
    .cartao { padding: 32px 40px; border-radius: 16px; background: #1b2030; box-shadow: 0 10px 40px #0008; text-align: center; }
    h1 { margin: 0 0 8px; color: #f5b041; }
    button { margin-top: 16px; padding: 10px 18px; border: 0; border-radius: 10px; background: #f5b041; color: #10131a; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <main class=""cartao"">
    <h1>Olá, senhor!</h1>
    <p>Este arquivo foi escrito pelo mascote do Jarvis.</p>
    <button id=""b"">Contar cliques: 0</button>
  </main>
  <script>
    // contador simples
    let n = 0;
    document.getElementById('b').onclick = e => { e.target.textContent = 'Contar cliques: ' + (++n); };
  </script>
</body>
</html>
";
            Fire("pensando_inicio", null);
            After(1500, () =>
            {
                Fire("acao", new Dictionary<string, object> { { "id", "teste-" + DateTime.Now.Ticks }, { "acao", "escrever" }, { "alvo", "vs code" }, { "arquivo", file }, { "conteudo", html } });
                Fire("concluido", null);
            });
        }
        void Fire(string type, Dictionary<string, object> d) { m.OnEvent(type, d ?? new Dictionary<string, object>()); }
        static void After(int ms, Action a) { var t = new FormsTimer { Interval = ms }; t.Tick += (s, e) => { t.Stop(); t.Dispose(); a(); }; t.Start(); }
        static void Shell(string path) { try { using (Process.Start(new ProcessStartInfo(path) { UseShellExecute = true })) { } } catch { } }

        static bool ParseHotkey(string s, out uint mods, out uint vk, bool allowBare = false)
        {
            mods = 0; vk = 0;
            foreach (var p in (s ?? "").Split('+').Select(x => x.Trim().ToLowerInvariant()))
            {
                if (p == "ctrl" || p == "control") mods |= W.MOD_CONTROL;
                else if (p == "alt") mods |= W.MOD_ALT;
                else if (p == "shift") mods |= W.MOD_SHIFT;
                else if (p == "win") mods |= W.MOD_WIN;
                else { Keys k; if (Enum.TryParse(p, true, out k)) vk = (uint)k; else return false; }
            }
            return vk != 0 && (mods != 0 || allowBare);
        }

        // Ícone da bandeja a partir do próprio sprite (escala inteira, sem borrar).
        static Icon MakeIcon(Frame f)
        {
            int size = 32, s = Math.Max(1, Math.Min(size / f.W, size / f.H));
            using (var b = new Bitmap(size, size))
            {
                using (var g = Graphics.FromImage(b))
                {
                    g.InterpolationMode = InterpolationMode.NearestNeighbor; g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.DrawImage(f.Bmp, (size - f.W * s) / 2, (size - f.H * s) / 2, f.W * s, f.H * s);
                }
                return Icon.FromHandle(b.GetHicon());
            }
        }

        void Quit()
        {
            Log.Write("saindo");
            try { W.UnregisterHotKey(ov.Handle, 1); W.UnregisterHotKey(ov.Handle, 2); } catch { }
            if (floatTimer != null) floatTimer.Stop();
            if (wake != null) wake.Dispose();
            vov.Dispose();
            Floating.Dispose();
            if (jc != null) jc.Stop();
            m.Dispose();
            tray.Visible = false; tray.Dispose();
            ServerHost.StopServer();
            ov.Close();
            ExitThread();
        }
    }
}
