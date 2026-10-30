// Máquina de estados do mascote. Tudo roda na thread da interface, guiado por UM timer:
// rápido (16 ms) quando há movimento, lento (100 ms) quando parado. Sem threads extras = cancelamento limpo:
// cancelar é só esvaziar a fila de passos.
//
//   IDLE ──pensando_inicio──▶ THINKING ──concluido/erro──▶ IDLE
//     │                          │
//     └────────── acao ──────────┴──▶ [ JUMPING (descer da janela) ] ─▶ WALKING ─▶ ACTING (abre o app e espera a janela)
//                                                                                     │
//                                                         IDLE (em cima da janela) ◀── JUMPING (pula na barra de título)
//   qualquer estado ──arrastar──▶ DRAGGED ──soltar──▶ FALLING ──▶ IDLE (no chão ou numa janela)
//   IDLE em cima de janela que fechou/minimizou ──▶ FALLING
//   modo Talk, parado e com a janela flutuante aberta: vai até ela e brinca em cima (anda, notebook, pensa, pulinhos)
//   acao "escrever" (modo Code): igual ao abrir (VS Code com o arquivo novo) ──▶ JUMPING na janela ──▶ WRITING (notebook) ──▶ IDLE
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;

namespace JarvisDesktop
{
    enum St { Idle, Thinking, Walking, Jumping, Acting, Writing, Dragged, Falling }

    class Target { public double X, Y; public IntPtr Win; }

    abstract class Step
    {
        public abstract void Start(Mascot m);
        public abstract bool Tick(Mascot m, double dt);   // true = terminou
    }

    class Mascot : IDisposable
    {
        public readonly Config Cfg;
        readonly Overlay ov; SpriteSet sp; readonly SpriteSet spNormal; readonly Renderer rd = new Renderer();
        // Roupa de carteiro (sprites-carteiro): só enquanto entrega algo na caixa de correio.
        public SpriteSet PostSkin; string skinTag = "";
        public bool Postman { get { return skinTag != ""; } set { bool on = value && PostSkin != null; if (on == Postman) return; sp = on ? PostSkin : spNormal; skinTag = on ? "c:" : ""; Render(true); } }
        readonly Timer timer = new Timer(); readonly Stopwatch clock = Stopwatch.StartNew();
        double lastT, animT, topmostT, groundT;
        double idleT; bool wandering;   // tempo parado sem nada acontecer; passeio à toa em andamento
        public bool TalkMode = true;    // modo do Jarvis (evento "modo"): no Talk, o Jarvis Code brinca em cima da janela flutuante
        public bool Doodle;             // mexendo no notebook por conta própria (brincadeira), mesmo antes do tempo de ócio
        double playWait = 3;            // segundos parado até a próxima brincadeira em cima da janela

        public double X, Y;                 // pés (pixels físicos da tela)
        public bool Left;                   // virado para a esquerda (sprite espelhado)
        St state = St.Idle;
        public St State { get { return state; } set { if (state != value) { Log.Write(string.Format("estado: {0} -> {1}  (pés em {2:0},{3:0})", state, value, X, Y)); state = value; animT = 0; } } }
        // Só para o teste automático: simula arrastar (sem mexer no mouse de verdade).
        public void SimulateDrag(int dx, int dy) { BeginDrag((int)X, (int)Y - 10); DragTo((int)X + dx, (int)Y - 10 + dy); }
        public void SimulateRelease() { EndDrag(); }
        public string Pose;                 // quadro escolhido por um passo (pulo/queda); null = automático pelo estado

        public IntPtr Perch; double perchOff;   // janela em que está em pé e distância da borda esquerda dela
        public IntPtr Ctx; public HashSet<IntPtr> Snap = new HashSet<IntPtr>(); public AppEntry CtxApp; public string CtxUrl, CtxFile, CtxRoot;

        readonly Queue<Step> plan = new Queue<Step>(); Step cur; string actionId;
        public Action<string, string, string> Report = delegate { };   // (id, status, detalhe) para o Jarvis
        public Action<string, string, string, string> SendCapture = delegate { };   // (id, imagem, de onde, erro)
        double grabDX, grabDY;

        public Mascot(Config cfg, Overlay overlay, SpriteSet sprites)
        {
            Cfg = cfg; ov = overlay; sp = spNormal = sprites;
            ov.DragStart += BeginDrag; ov.DragMove += DragTo; ov.DragEnd += (x, y) => EndDrag(); ov.Clicked += Poke;
            timer.Tick += (s, e) => Tick();
            Home();
            lastT = clock.Elapsed.TotalSeconds; timer.Interval = 16; timer.Start();
            Enqueue(new GestureStep("acenar", 2.0));   // chegou: dá tchau
        }
        public void ResetAnim() { animT = 0; }
        // Chamado só para uma tarefa (estava guardado): terminou e ficou parado uns segundos, dá tchau, pula e some.
        public bool AutoHide; public event Action Vanished; double hideSince = -1;   // relógio real (o timer fica lento quando parado)
        public void SetFade(double a) { ov.Alpha = (byte)Math.Max(0, Math.Min(255, Math.Round(a * 255))); }
        public void VanishDone() { ov.Visible = false; ov.Alpha = 255; AutoHide = false; Postman = false; Log.Write("Jarvis Code: sumiu depois da tarefa"); if (Vanished != null) Vanished(); }

        /* ---------- Medidas ---------- */
        public Monitor Mon { get { return Desktop.MonitorAt((int)X, (int)Y - 2); } }
        public int Scale { get { return Math.Max(1, (int)Math.Floor(Cfg.escala * Mon.Scale + 0.5)); } }   // sempre inteiro (pixel-perfect)
        public int BodyHeight { get { return rd.Get("parado|0", sp["parado"].Frames[0], Scale, false).BodyH; } }
        public double Ground(double x) { return Desktop.MonitorAt((int)x, (int)Y - 2).Work.B; }

        // Onde ficar em cima de uma janela: na borda de cima; se não houver espaço acima (janela maximizada), dentro da barra de título.
        public int PerchY(W.RECT r)
        {
            var mon = Desktop.MonitorAt(r.L + r.Width / 2, r.T + 4);
            return r.T - BodyHeight < mon.Area.T ? r.T + (int)(32 * mon.Scale) : r.T;
        }
        public void SetPerch(IntPtr win) { Perch = win; if (win != IntPtr.Zero) perchOff = X - W.Bounds(win).L; }

        /* ---------- Fila de passos ---------- */
        public void Enqueue(Step s) { plan.Enqueue(s); WakeUp(); }
        public void Run(Step s) { cur = null; plan.Clear(); Enqueue(s); }
        public void CancelPlan(bool report)
        {
            FlushWrites();   // o arquivo nunca fica pela metade: o que faltava digitar é gravado de uma vez
            cur = null; plan.Clear(); Pose = null; wandering = false; idleT = 0; Doodle = false;
            if (actionId != null && report) { Log.Write("ação " + actionId + " cancelada"); Report(actionId, "cancelado", ""); }
            actionId = null;
        }
        public void Finish(string status, string detail)
        {
            if (actionId != null) Report(actionId, status, detail);
            actionId = null;
        }
        public void Fail(string msg)
        {
            Log.Write("falha: " + msg);
            Finish("erro", msg);
            FlushWrites();
            cur = null; plan.Clear(); Pose = null;
            Enqueue(new HoldThinkStep(1.8));   // fica um pouco com o "?" e volta ao ocioso
        }

        void FlushWrites()
        {
            var w = cur as IFlushable; if (w != null) w.Flush();
            foreach (var s in plan) { w = s as IFlushable; if (w != null) w.Flush(); }
        }

        /* ---------- Eventos do Jarvis ---------- */
        public void OnEvent(string type, Dictionary<string, object> d)
        {
            if (type == "modo")
            {
                bool talk = Str(d, "modo") != "code";
                if (talk != TalkMode) Log.Write("modo do Jarvis: " + (talk ? "Talk" : "Code"));
                TalkMode = talk; if (!talk && wandering) { CancelPlan(false); State = St.Idle; }
                return;
            }
            Log.Write("evento: " + type);
            bool asleep = Typing;
            idleT = 0; hideSince = -1;
            if (cur is VanishStep) { cur = null; plan.Clear(); Pose = null; SetFade(1); }   // chegou outra coisa enquanto sumia: fica
            if (asleep && type != "emocao") Feel("surpreso", 1.2);   // estava dormindo: acorda assustado
            if (wandering) { CancelPlan(false); State = St.Idle; }   // qualquer coisa do Jarvis interrompe o passeio
            switch (type)
            {
                case "pensando_inicio": if (State == St.Idle || State == St.Thinking) { State = St.Thinking; WakeUp(); } break;
                case "concluido": if (State == St.Thinking && cur == null && plan.Count == 0) State = St.Idle; break;
                case "erro": if (State == St.Thinking && cur == null && plan.Count == 0) Enqueue(new HoldThinkStep(1.8)); Feel("triste", 2.2); break;
                case "emocao": { double sec; try { sec = Convert.ToDouble(d != null && d.ContainsKey("segundos") ? d["segundos"] : 2.5); } catch { sec = 2.5; } Feel(Str(d, "nome"), sec); break; }
                case "acao":
                    Postman = false;   // tarefa comum: roupa de sempre
                    var ac = Str(d, "acao");
                    if (ac == "clicar" || ac == "rolar") ClickAt(Str(d, "id"), Str(d, "captura"), Str(d, "x"), Str(d, "y"), Str(d, "alvo"), Str(d, "duplo") == "True", ac == "rolar" ? (Str(d, "direcao") == "cima" ? 5 : -5) : 0);
                    else if (ac == "segurar") HoldKeys(Str(d, "id"), Str(d, "teclas"), IntOf(d, "ms"), Str(d, "inicio") == "True");
                    else if (ac == "digitar" || ac == "tecla") KeyAction(Str(d, "id"), ac, Str(d, "texto"), Str(d, "tecla"), Str(d, "enter") == "True");
                    else DoAction(Str(d, "id"), Str(d, "acao"), Str(d, "alvo"), Str(d, "url"), Str(d, "arquivo"), Str(d, "conteudo"), IntOf(d, "monitor"), Str(d, "pasta"));
                    break;
                case "capturar": Capture(Str(d, "id"), IntOf(d, "monitor"), Str(d, "inteiro") == "True"); break;
            }
        }
        static string Str(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v != null ? v.ToString() : null; }

        // Número vindo do Jarvis (1 = monitor principal, 2, 3...); 0 = não pediu.
        static int IntOf(Dictionary<string, object> d, string k) { object v; try { return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToInt32(v) : 0; } catch { return 0; } }

        public void DoAction(string id, string acao, string alvo, string url, string arquivo = null, string conteudo = null, int monitor = 0, string pasta = null)
        {
            // Pasta de projeto (escolhida no Jarvis): o arquivo fica lá. Pasta inválida = recusa (nunca cai em outro lugar).
            string root = string.IsNullOrEmpty(pasta) ? null : Actions.ProjectRoot(pasta);
            if (!string.IsNullOrEmpty(pasta) && root == null) { Log.Write("pasta de projeto recusada: " + pasta); if (id != null) Report(id, "nao_permitido", "pasta de projeto recusada"); return; }
            if (State == St.Dragged) { if (id != null) Report(id, "cancelado", "mascote sendo arrastado"); WriteNow(acao, arquivo, conteudo, root); return; }
            var app = Cfg.Resolve(alvo);
            bool write = acao == "escrever";
            bool ok = app != null && (acao == "abrir_app" || (acao == "abrir_url" && Actions.ValidUrl(url) && !string.IsNullOrEmpty(app.argumentosUrl))
                || (write && Cfg.PodeEscrever && !string.IsNullOrEmpty(app.argumentosArquivo) && Actions.ValidCodeFile(Cfg, arquivo, root) && conteudo != null && conteudo.Length <= Actions.MaxCodeChars));
            string why = "fora da allowlist";
            // Escrever: só um arquivo novo (ou o vazio que o Jarvis acabou de criar). Nunca por cima de algo que já tem conteúdo.
            if (ok && write)
            {
                try
                {
                    var f = Path.GetFullPath(arquivo); Directory.CreateDirectory(root == null ? Cfg.PastaCodigo : Path.GetDirectoryName(f));
                    if (File.Exists(f) && new FileInfo(f).Length > 0) { ok = false; why = "o arquivo já existe com conteúdo"; }
                    else if (!File.Exists(f)) File.WriteAllText(f, "", new UTF8Encoding(false));
                    if (ok && Cfg.Digitar && root == null) TypeStep.EnsureWorkspaceSettings(Cfg.PastaCodigo);   // no projeto do usuário não criamos .vscode   // antes de abrir o VS Code
                }
                catch (Exception e) { ok = false; why = "não consegui criar o arquivo: " + e.Message; }
            }
            if (!ok)
            {
                Log.Write("ação recusada (" + why + "): " + acao + " " + alvo + (write ? " " + arquivo : ""));
                if (id != null) Report(id, "nao_permitido", why);
                Run(new HoldThinkStep(1.5)); return;
            }
            CancelPlan(true);   // uma ação nova substitui a anterior
            actionId = id ?? ("local-" + DateTime.Now.Ticks); CtxApp = app; CtxUrl = acao == "abrir_url" ? url : null;
            CtxFile = write ? Path.GetFullPath(arquivo) : null; CtxRoot = write ? root : null;
            Step ws = !write ? null : Cfg.Digitar ? (Step)new TypeStep(CtxFile, conteudo) : new WriteStep(CtxFile, conteudo);
            var target = monitor > 0 ? Desktop.MonitorNumber(monitor) : null;   // monitor pedido (null = onde a janela abrir)
            if (monitor > 0 && target == null) Log.Write("monitor " + monitor + " não existe: abrindo onde a janela aparecer");
            // Escrevendo com a janela flutuante do Jarvis aberta: o Jarvis Code anda até ela e digita em cima dela
            // (o VS Code fica livre na tela). Sem a flutuante, sobe no VS Code como antes.
            bool onFloat = write && Floating.Handle != IntPtr.Zero;
            Func<Target> perch = onFloat ? (Func<Target>)OntoFloat : OntoCtx;
            var existing = Desktop.FindApp(app);
            if (existing != null)
            {
                // Já aberto: anda até a janela, traz para a frente (e abre a URL nela, se for site) e sobe nela.
                Ctx = existing.H;
                if (onFloat) { if (Perch != Floating.Handle) { DropIfNeeded(); Enqueue(new WalkStep(() => ApproachX(Floating.Handle))); } }
                else if (Perch != existing.H) { DropIfNeeded(); Enqueue(new WalkStep(() => ApproachX(Ctx))); }
                Enqueue(new FocusStep());
                if (CtxUrl != null || CtxFile != null) { Enqueue(new LaunchStep()); Enqueue(new WaitWindowStep(CtxFile != null ? 6 : 2.5)); }
                if (target != null) Enqueue(new MoveToMonitorStep(target));   // "no segundo monitor": a janela vai para lá
                if (!onFloat || Perch != Floating.Handle) Enqueue(new JumpStep(this, perch));
            }
            else
            {
                // Não aberto: anda até um ponto padrão (centro da área de trabalho do monitor pedido, ou do atual; ou embaixo da flutuante),
                // abre, espera a janela e (se pediram um monitor) leva a janela para lá.
                DropIfNeeded();
                Enqueue(new WalkStep(() => { if (onFloat && Floating.Handle != IntPtr.Zero) return ApproachX(Floating.Handle); var w = (target ?? Mon).Work; return w.L + w.Width / 2.0; }));
                Enqueue(new LaunchStep());
                Enqueue(new WaitWindowStep(CtxFile != null ? 20 : 12));   // o VS Code demora mais para abrir
                if (target != null) Enqueue(new MoveToMonitorStep(target));
                Enqueue(new JumpStep(this, perch));
            }
            if (ws != null) Enqueue(ws);   // em cima da janela, pega o notebook e "digita" o arquivo
            Enqueue(new DoneStep());
            if (ws != null) Enqueue(new CelebrateStep(3));   // terminou de escrever: comemora com pulinhos
            Enqueue(new GestureStep("cumprimentar", 2.0));   // tarefa feita: tira o chapéu
        }

        // Sendo arrastado quando chega um "escrever": não anda nem abre nada, mas o arquivo não fica vazio.
        void WriteNow(string acao, string arquivo, string conteudo, string root = null)
        {
            if (acao != "escrever" || !Cfg.PodeEscrever || conteudo == null || conteudo.Length > Actions.MaxCodeChars || !Actions.ValidCodeFile(Cfg, arquivo, root)) return;
            try { var f = Path.GetFullPath(arquivo); if (!File.Exists(f) || new FileInfo(f).Length == 0) new WriteStep(f, conteudo).Flush(); } catch { }
        }

        // O Jarvis pediu para ver a tela: foto da janela em que o mascote está em pé; no chão, do monitor inteiro.
        string capId; W.RECT capRect; DateTime capAt;

        // Clique pedido pelo Jarvis: ponto (0–1000) dentro da última foto. Só em navegador, um clique, conferido antes.
        // scroll != 0: em vez de clicar, rola a roda do mouse sobre o ponto (tarefas de vários passos).
        void ClickAt(string id, string captura, string sx, string sy, string alvo, bool dbl = false, int scroll = 0)
        {
            int nx, ny; string why = null;
            if (!Cfg.PodeClicar) why = "clicar está desligado no config.json";
            else if (scroll != 0 && !Cfg.PodeTeclado) why = "tarefas (rolar/teclado) estão desligadas no config.json";
            else if (State == St.Dragged) why = "sendo arrastado";
            else if (captura == null || captura != capId || (DateTime.UtcNow - capAt).TotalSeconds > 120) why = "a foto da tela expirou";
            else if (!int.TryParse(sx, out nx) || !int.TryParse(sy, out ny) || nx < 0 || nx > 1000 || ny < 0 || ny > 1000) why = "ponto inválido";
            else
            {
                int px = capRect.L + (int)Math.Round(capRect.Width * nx / 1000.0), py = capRect.T + (int)Math.Round(capRect.Height * ny / 1000.0);
                var root = Mouse.RootAt(px, py);
                if (root == Floating.Handle && root != IntPtr.Zero) why = "a janela do Jarvis está por cima desse ponto";
                else if (root == IntPtr.Zero || !Mouse.IsClickable(Cfg, root)) why = "o ponto está numa janela de segurança do Windows";
                else
                {
                    if (scroll != 0)
                    {
                        CancelPlan(true); actionId = id ?? ("local-" + DateTime.Now.Ticks);
                        Enqueue(new ScrollStep(px, py, root, scroll)); Enqueue(new DoneStep()); return;
                    }
                    Log.Write("clicar: " + (alvo ?? "?") + " em " + px + "," + py);
                    CancelPlan(true); actionId = id ?? ("local-" + DateTime.Now.Ticks); Perch = IntPtr.Zero;
                    double s = Mon.Scale; var stand = new Target { X = px + 42 * s, Y = py + BodyHeight * 0.55, Win = IntPtr.Zero };   // ao lado do ponto, sem cobri-lo
                    Enqueue(new JumpStep(this, () => stand));
                    Enqueue(new ClickStep(px, py, root, dbl));
                    Enqueue(new FallStep());
                    return;
                }
            }
            Log.Write("clique recusado: " + why);
            if (id != null) Report(id, "nao_permitido", why);
            Run(new HoldThinkStep(1.5));
        }

        // Tarefas: digitar o texto que o Jarvis mandou (o servidor só deixa passar palavras ditas pelo usuário) ou apertar UMA tecla da lista fixa.
        void KeyAction(string id, string acao, string texto, string tecla, bool enter)
        {
            string why = null;
            if (!Cfg.PodeTeclado) why = "teclado desligado no config.json (permitirTeclado)";
            else if (State == St.Dragged) why = "sendo arrastado";
            else if (acao == "tecla" && !Kbd.IsAllowed(tecla)) why = "tecla fora da lista";
            else if (acao == "digitar" && (string.IsNullOrEmpty(texto) || texto.Length > 120 || texto.IndexOfAny(new[] { '\r', '\n', '\t' }) >= 0)) why = "texto inválido";
            if (why != null)
            {
                Log.Write("teclado recusado: " + why);
                if (id != null) Report(id, "nao_permitido", why);
                Run(new HoldThinkStep(1.5)); return;
            }
            CancelPlan(true); actionId = id ?? ("local-" + DateTime.Now.Ticks);
            Enqueue(acao == "tecla" ? (Step)new KeyStep(tecla) : new TextStep(texto, enter));
            Enqueue(new DoneStep());
        }

        // Jogar: segura até 3 teclas da lista de jogo (letras, números, espaço, Shift, Enter, setas) por 60–1500 ms.
        void HoldKeys(string id, string teclas, int ms, bool inicio)
        {
            string why = null; var vks = new List<ushort>();
            foreach (var k in (teclas ?? "").Split(',')) { var vk = Kbd.GameVk(k.Trim()); if (vk == 0) { why = "tecla fora da lista de jogo"; break; } if (!vks.Contains(vk)) vks.Add(vk); }
            if (why == null && (vks.Count == 0 || vks.Count > 3)) why = "teclas inválidas";
            if (!Cfg.PodeTeclado) why = "teclado desligado no config.json (permitirTeclado)";
            else if (State == St.Dragged) why = "sendo arrastado";
            if (why != null)
            {
                Log.Write("jogo recusado: " + why);
                if (id != null) Report(id, "nao_permitido", why);
                return;
            }
            CancelPlan(true); actionId = id ?? ("local-" + DateTime.Now.Ticks);
            Enqueue(new HoldStep(vks.ToArray(), Math.Max(60, Math.Min(1500, ms)), inicio));
        }

        void Capture(string id, int monitor = 0, bool whole = false)
        {
            if (id == null) return;
            if (!Cfg.LerTela) { SendCapture(id, null, "", "Ler a tela está desligado no config.json do mascote."); return; }
            try
            {
                W.RECT r; string label; var pedido = monitor > 0 ? Desktop.MonitorNumber(monitor) : null;
                // Monitor pedido ("olha meu segundo monitor"): a foto é dele inteiro.
                if (pedido != null) { r = pedido.Area; label = monitor == 1 ? "monitor principal" : "monitor " + monitor; }
                // Em cima da janela do Jarvis (flutuante), a foto é do monitor: a janela dele não interessa.
                // Tarefas (inteiro): o monitor todo, para ver pop-ups e outras janelas além da que ele está em cima.
                else if (!whole && Desktop.Usable(Perch) && Perch != Floating.Handle) { r = W.Bounds(Perch); label = "janela \"" + W.Text(Perch) + "\""; }
                else { r = Mon.Area; label = "monitor onde o mascote está"; }
                string img = Desktop.CaptureJpeg(r);
                capId = id; capRect = r; capAt = DateTime.UtcNow;   // um clique pedido depois aponta dentro DESTA foto
                Log.Write("captura enviada (" + label + ", " + r + ", " + img.Length / 1024 + " KB)");
                SendCapture(id, img, label, null);
            }
            catch (Exception e) { Log.Write("falha na captura: " + e.Message); SendCapture(id, null, "", "Não consegui capturar a tela."); }
        }

        void DropIfNeeded()
        {
            double gx = X, gy = Ground(X);
            if (Perch != IntPtr.Zero || Y < gy - 3) Enqueue(new JumpStep(this, () => new Target { X = gx, Y = Ground(gx), Win = IntPtr.Zero }));
        }
        double ApproachX(IntPtr win)
        {
            if (!Desktop.Usable(win)) return X;
            var r = W.Bounds(win); var m = Desktop.MonitorAt(r.L + r.Width / 2, r.T + 4);
            double x = Math.Max(r.L + r.Width * 0.15, Math.Min(r.R - r.Width * 0.15, X));
            return Math.Max(m.Work.L + 40, Math.Min(m.Work.R - 40, x));
        }
        double ontoOff = double.NaN; IntPtr ontoWin;
        Target OntoCtx() { return Onto(Ctx); }
        // Em cima da janela flutuante do Jarvis (se ela fechou no caminho, volta para a janela do app).
        Target OntoFloat() { var h = Floating.Handle; return h != IntPtr.Zero && Desktop.Usable(h) ? Onto(h) : OntoCtx(); }
        Target Onto(IntPtr win)
        {
            if (!Desktop.Usable(win)) return null;
            var r = W.Bounds(win);
            if (ontoWin != win || double.IsNaN(ontoOff)) { ontoWin = win; ontoOff = Math.Max(r.Width * 0.15, Math.Min(r.Width * 0.85, X - r.L)); }
            return new Target { X = r.L + ontoOff, Y = PerchY(r), Win = win };
        }
        public void ResetOnto() { ontoOff = double.NaN; }

        /* ---------- Arrastar ---------- */
        void BeginDrag(int x, int y)
        {
            CancelPlan(true);   // arrastar cancela na hora o que estiver em andamento
            wokeByDrag = Typing; shakes = 0; lastDir = 0; lastDragX = x; feel = null;
            Perch = IntPtr.Zero; State = St.Dragged; Pose = null;
            grabDX = X - x; grabDY = Y - y; WakeUp();
        }
        void DragTo(int x, int y)
        {
            if (State != St.Dragged) return;
            // Chacoalhar: cada vez que o arrasto troca de direção (com força) conta uma sacudida.
            if (Math.Abs(x - lastDragX) > 10 * Mon.Scale) { int dir = Math.Sign(x - lastDragX); if (lastDir != 0 && dir != lastDir) shakes++; lastDir = dir; lastDragX = x; }
            X = x + grabDX; Y = y + grabDY; Render();
        }
        void EndDrag() { if (State == St.Dragged) { shaken = shakes >= 6; Run(new FallStep()); } }

        /* ---------- Expressões ----------
           Uma "cara" por cima do que ele estiver fazendo, só quando está parado (nunca interrompe uma tarefa).
           Pedida pelo Jarvis (evento "emocao") ou aqui mesmo: cutucar, chacoalhar, queda alta, acordar. */
        string feel; double feelLeft, feelT, feelAge;
        bool wokeByDrag, shaken; int shakes, lastDir, pokes; double lastDragX, pokeT = -10;
        public void Feel(string anim, double secs)
        {
            if (!sp.Has(anim) || Array.IndexOf(SpriteSet.Moods, anim) < 0) return;
            feel = anim; feelLeft = Math.Max(0.8, Math.Min(6, secs)); feelT = 0; feelAge = 0; idleT = 0; WakeUp();
            Log.Write("expressão: " + anim);
        }
        bool FeelShown { get { return feel != null && State == St.Idle && Pose == null; } }
        // Cutucar (clique simples): 1 toque assusta; 2–3 seguidos dão cócegas; 4 ou mais irritam.
        void Poke()
        {
            double now = clock.Elapsed.TotalSeconds;
            pokes = now - pokeT < 1.6 ? pokes + 1 : 1; pokeT = now;
            if (pokes >= 4) Feel("bravo", 2.6); else if (pokes >= 2) Feel("feliz", 1.4); else Feel("surpreso", 1.0);
        }
        // Aterrissou depois de cair (dist em pixels): chacoalhado ou queda alta deixam tonto; queda média assusta.
        public void Landed(double dist)
        {
            double h = Mon.Work.B - Mon.Work.T;
            if (shaken || dist > h * 0.45) Feel("tonto", 3.0);
            else if (dist > 160 * Mon.Scale || wokeByDrag) Feel("surpreso", 1.2);
            shaken = false; wokeByDrag = false;
        }

        /* ---------- Posição inicial ---------- */
        public void Home()
        {
            CancelPlan(true); Perch = IntPtr.Zero; Pose = null;
            var w = Desktop.MonitorAt(0, 0).Work;   // monitor principal
            X = w.R - 90 * Desktop.MonitorAt(0, 0).Scale; Y = w.B; Left = true; State = St.Idle; Render(); WakeUp();
        }
        // Aparece esmaecendo (0,35 s), como o sumir.
        public void SetVisible(bool v) { if (v && !ov.Visible) { fadeIn = 0; ov.Alpha = 0; } ov.Visible = v; if (v) { Render(true); WakeUp(); } }
        double fadeIn = 1;

        /* ---------- Laço ---------- */
        void WakeUp() { if (timer.Interval != 16) timer.Interval = 16; }
        void Tick()
        {
            double now = clock.Elapsed.TotalSeconds, dt = Math.Min(0.05, now - lastT); lastT = now;
            if (!ov.Visible) return;
            if (cur == null && plan.Count > 0) { cur = plan.Dequeue(); cur.Start(this); }
            if (cur != null && cur.Tick(this, dt)) cur = null;
            if (cur == null && plan.Count == 0 && Perch != IntPtr.Zero && (State == St.Idle || State == St.Thinking)) TrackPerch();
            if (cur == null && plan.Count == 0 && Perch == IntPtr.Zero && State == St.Idle && (groundT += dt) > 2)
            {   // barra de tarefas mudou de lugar/tamanho, resolução mudou: volta ao chão
                groundT = 0; double g = Ground(X); if (Math.Abs(Y - g) > 2) Run(new FallStep());
            }
            // Ocioso: depois de um tempo pega o notebook (só a animação); mais um tempo, sai andando à toa.
            bool still = cur == null && plan.Count == 0 && State == St.Idle;
            var fl = Floating.Handle;
            bool playful = TalkMode && fl != IntPtr.Zero && Desktop.Usable(fl);
            // Chamado só para a tarefa: parado 3,5 s depois dela, vai embora (em vez de passear ou ir brincar na janela).
            if (still && AutoHide && feel == null && !Typing) { if (hideSince < 0) hideSince = now; if (now - hideSince >= 3.5) { hideSince = -1; Run(new VanishStep()); } }
            else if (!still) hideSince = -1;
            if (still && AutoHide) { }
            else if (still && playful)
            {   // Modo Talk: vive em cima da janela do Jarvis. Longe dela, volta; em cima, brinca de tempos em tempos.
                idleT += dt;
                if (Perch != fl) { if (idleT >= 4) GoToFloat(fl); }
                else if (idleT >= playWait) Play();
            }
            else if (still) { idleT += dt; if (Cfg.ociosoPasseio > 0 && idleT >= Cfg.ociosoPasseio) Wander(); }
            else if (!wandering) idleT = 0;
            animT += dt;
            if (fadeIn < 1 && !(cur is VanishStep)) { fadeIn = Math.Min(1, fadeIn + dt / 0.35); SetFade(fadeIn); }
            if (feel != null)
            {
                feelAge += dt;
                if (FeelShown) { feelT += dt; feelLeft -= dt; idleT = 0; }
                if (feelLeft <= 0 || (feelT == 0 && feelAge > 10)) feel = null;   // ocupado por muito tempo: a cara perde a graça
            }
            if ((topmostT += dt) > 2) { topmostT = 0; ov.KeepOnTop(); }
            Render();
            bool calm = cur == null && plan.Count == 0 && (State == St.Idle || State == St.Thinking) && feel == null;
            int want = !calm ? 16 : Typing ? Math.Max(16, (int)(500 / Cfg.fps.notebook)) : 100;   // parado: 10 atualizações/s; digitando: o dobro do fps da animação
            if (timer.Interval != want) timer.Interval = want;
        }

        // Modo de teste: pula direto para o notebook ou para o passeio.
        public void IdleNow(bool walk)
        {
            if (State != St.Idle || cur != null || plan.Count > 0) return;
            if (walk) Wander(); else { idleT = Math.Max(Cfg.ociosoNotebook ?? 60, 0.01); animT = 0; Log.Write("ocioso: notebook (teste)"); }
            WakeUp();
        }
        public bool Wandering { get { return wandering; } set { wandering = value; } }
        // Parado há muito tempo sem nada acontecer: dorme (ociosoNotebook no config.json). "Doodle" (teste) também.
        public bool Typing { get { return State == St.Idle && (Doodle || cur == null && plan.Count == 0 && Cfg.ociosoNotebook > 0 && idleT >= Cfg.ociosoNotebook); } }

        // Modo Talk: anda até a janela flutuante do Jarvis e pula em cima dela.
        // Entrega no correio: veste o uniforme e corre até o meio da tela, embaixo do V (win null; o correio é um pop-up no V)
        // ou até uma janela (espera ela aparecer e sobe em cima). Depois
        // entrega (aceno) e tira o boné. Chamado só para isso, depois vai embora sozinho (AutoHide).
        public void Deliver(Func<IntPtr> win)
        {
            CancelPlan(false); idleT = 0; hideSince = -1; Postman = true; WakeUp();
            Log.Write("correio: o Jarvis Code vai entregar");
            DropIfNeeded();
            if (win == null)
            {   // sem janela: a entrega é no V, então vai até o meio da tela (embaixo da ponta do V)
                var w = Desktop.MonitorAt(0, 0).Work;
                Enqueue(new WalkStep(() => w.L + w.Width / 2.0));
            }
            else
            {
                Enqueue(new WaitForStep(win, 10));
                Enqueue(new WalkStep(() => { var h = win(); return h != IntPtr.Zero && Desktop.Usable(h) ? ApproachX(h) : X; }));
                Enqueue(new JumpStep(this, () => { var h = win(); return h != IntPtr.Zero && Desktop.Usable(h) ? Onto(h) : null; }));
            }
            Enqueue(new GestureStep("acenar", 1.6));          // entrega a carta
            Enqueue(new GestureStep("cumprimentar", 1.8));    // tira o boné
            if (!AutoHide) Enqueue(new SkinStep(false));      // ficando na tela: volta à roupa de sempre
        }

        void GoToFloat(IntPtr fl)
        {
            idleT = 0; wandering = true;   // qualquer coisa do Jarvis interrompe, como no passeio
            Log.Write("modo Talk: indo para a janela do Jarvis");
            DropIfNeeded();
            Enqueue(new WalkStep(() => Desktop.Usable(fl) ? ApproachX(fl) : X));
            Enqueue(new JumpStep(this, () => Desktop.Usable(fl) ? Onto(fl) : null));
            Enqueue(new EndWanderStep());
        }
        // Em cima da janela: sorteia uma brincadeira (andar até outro ponto, notebook, pensar, pulinhos).
        void Play()
        {
            idleT = 0; wandering = true; playWait = 2 + rng.NextDouble() * 4;
            var r = W.Bounds(Perch); double w = r.Width, cur0 = PerchOff;
            int pick = rng.Next(100);
            if (pick < 45)
            {   // anda até outro ponto da borda (pelo menos um pouco longe de onde está)
                double to = w * (0.1 + rng.NextDouble() * 0.8);
                if (Math.Abs(to - cur0) < w * 0.2) to = cur0 < w / 2 ? cur0 + w * 0.3 : cur0 - w * 0.3;
                Enqueue(new PerchWalkStep(Math.Max(w * 0.08, Math.Min(w * 0.92, to))));
                if (rng.Next(3) == 0) Enqueue(new PerchWalkStep(w * (0.15 + rng.NextDouble() * 0.7)));
            }
            else if (pick < 70) Enqueue(new DoodleStep(4 + rng.NextDouble() * 5));   // mexe no notebook
            else if (pick < 85) Enqueue(new HoldThinkStep(2 + rng.NextDouble() * 2));  // fica pensando
            else Enqueue(new CelebrateStep(1 + rng.Next(2)));                           // pulinhos
            Enqueue(new EndWanderStep());
        }
        public double PerchOff { get { return perchOff; } set { perchOff = value; } }

        // Passeio: desce da janela (se estiver numa) e anda até 1–3 pontos aleatórios do monitor, com pausas.
        static readonly Random rng = new Random();
        void Wander()
        {
            idleT = 0; wandering = true;
            Log.Write("ocioso: passeando");
            DropIfNeeded();
            int legs = rng.Next(1, 4);
            for (int i = 0; i < legs; i++)
            {
                double? dest = null;   // sorteado uma vez, quando o trecho começa (o WalkStep consulta o alvo a cada quadro)
                Enqueue(new WalkStep(() =>
                {
                    if (dest != null) return dest.Value;
                    var w = Mon.Work; double m = 60 * Mon.Scale, lo = w.L + m, hi = w.R - m;
                    double x = lo + rng.NextDouble() * Math.Max(1, hi - lo);
                    if (Math.Abs(x - X) < 150 * Mon.Scale) x = X + (X - lo > hi - X ? -1 : 1) * 150 * Mon.Scale;   // anda pelo menos um pouco
                    dest = Math.Max(lo, Math.Min(hi, x)); return dest.Value;
                }));
                Enqueue(new PauseStep(1 + rng.NextDouble() * 2));
            }
            Enqueue(new EndWanderStep());
        }

        // Escrevendo em cima da janela: acompanha se ela mover; se ela sumir, termina de escrever e depois cai.
        public void FollowPerch()
        {
            if (Perch == IntPtr.Zero) return;
            if (!Desktop.Usable(Perch)) { Perch = IntPtr.Zero; return; }
            var r = W.Bounds(Perch); X = Math.Max(r.L + 4, Math.Min(r.R - 4, r.L + perchOff)); Y = PerchY(r);
        }

        void TrackPerch()
        {
            if (!Desktop.Usable(Perch)) { Log.Write("a janela de apoio sumiu: caindo"); Perch = IntPtr.Zero; Run(new FallStep()); return; }
            var r = W.Bounds(Perch);
            X = Math.Max(r.L + 4, Math.Min(r.R - 4, r.L + perchOff)); Y = PerchY(r);   // acompanha a janela se ela mover
        }

        /* ---------- Desenho ---------- */
        public void Render(bool force = false)
        {
            string key; Frame f; Choose(out key, out f);
            var img = rd.Get(skinTag + key, f, Scale, Left && !key.StartsWith("digitar"));   // digitar nunca espelha (o código da tela ficaria ao contrário)
            ov.Present(img.HBmp, img.W, img.H, (int)Math.Round(X) - img.AX, (int)Math.Round(Y) - img.AY);
        }
        void Choose(out string key, out Frame f)
        {
            if (Pose != null) { Pick(Pose, out key, out f); return; }
            if (FeelShown) { var a = sp[feel]; int i = a.At(feelT); key = feel + "|" + i; f = a.Frames[i]; return; }
            switch (State)
            {
                case St.Walking: Loop(wandering ? "andar" : "correr", out key, out f); return;   // passeio anda; indo fazer algo, corre
                case St.Thinking: Loop("pensar", out key, out f); return;
                case St.Acting:
                case St.Writing: Loop("digitar", out key, out f); return;                         // abrindo app, apertando teclas, digitando
                case St.Dragged: Loop("arrastado", out key, out f); return;
                case St.Falling: Jump(4, out key, out f); return;
                default:
                    Loop(Typing ? "dormir" : "parado", out key, out f); return;
            }
        }
        void Loop(string anim, out string key, out Frame f) { var a = sp[anim]; int i = a.At(animT); key = anim + "|" + i; f = a.Frames[i]; }
        // Quadros do pulo usados pelos passos (j0..j7: preparar, subir, topo, descer, aterrissar).
        static readonly int[] JumpMap = { 0, 0, 2, 4, 5, 6, 7, 7 };
        void Jump(int j, out string key, out Frame f) { var a = sp["pular"]; int i = Math.Min(a.Frames.Length - 1, JumpMap[Math.Max(0, Math.Min(7, j))]); key = "pular|" + i; f = a.Frames[i]; }
        // Pose escolhida por um passo: "jN" (pulo) ou "@nome" (gesto em laço: acenar, cumprimentar...).
        void Pick(string pose, out string key, out Frame f)
        {
            if (pose[0] == '@') { var a = sp[pose.Substring(1)]; int i = a.At(animT); key = a.Name + "|" + i; f = a.Frames[i]; return; }
            int j; if (pose[0] == 'j' && int.TryParse(pose.Substring(1), out j)) { Jump(j, out key, out f); return; }
            Loop("parado", out key, out f);
        }

        public void Dispose() { timer.Stop(); timer.Dispose(); rd.Dispose(); }
    }

    /* ======================= Passos ======================= */

    class WalkStep : Step
    {
        readonly Func<double> target; double y0, y1, x0;
        public WalkStep(Func<double> t) { target = t; }
        public override void Start(Mascot m) { m.State = St.Walking; m.Pose = null; m.Perch = IntPtr.Zero; x0 = m.X; y0 = m.Y; y1 = m.Ground(target()); }
        public override bool Tick(Mascot m, double dt)
        {
            double tx = target(), dx = tx - m.X, step = m.Cfg.velocidadeAndar * m.Mon.Scale * dt;
            if (Math.Abs(dx) > 0.5) m.Left = dx < 0;
            double total = Math.Abs(tx - x0);
            if (Math.Abs(dx) <= step) { m.X = tx; m.Y = m.Ground(tx); return true; }
            m.X += Math.Sign(dx) * step;
            m.Y = total > 1 ? y0 + (y1 - y0) * (1 - Math.Abs(tx - m.X) / total) : y1;   // atravessando monitores com chãos diferentes
            return false;
        }
    }

    // Pulo em arco (curva de Bézier quadrática) com fases: preparação J1–J2, subida J3, ápice J4, descida J5, aterrissagem J6–J8.
    // O alvo é consultado a cada quadro: se a janela mexer durante o pulo, ele corrige a trajetória.
    class JumpStep : Step
    {
        readonly Func<Target> target; readonly Mascot owner; int phase; double t, T, x0, y0; Target last;
        public JumpStep(Mascot m, Func<Target> t) { owner = m; target = t; }
        public override void Start(Mascot m) { m.State = St.Jumping; phase = 0; t = 0; m.ResetOnto(); last = target(); if (last == null) m.Fail("A janela sumiu antes do pulo."); }
        public override bool Tick(Mascot m, double dt)
        {
            if (last == null) return true;
            double fd = 1.0 / m.Cfg.fps.pular; t += dt;
            if (phase == 0)
            {
                m.Pose = t < fd ? "j0" : "j1";
                if (t < fd * 2) return false;
                phase = 1; t = 0; x0 = m.X; y0 = m.Y; m.Perch = IntPtr.Zero;
                var a = target() ?? last; last = a;
                T = Math.Max(0.45, Math.Min(1.2, 0.42 + Math.Abs(a.Y - y0) / 1800 + Math.Abs(a.X - x0) / 2600));
            }
            if (phase == 1)
            {
                var a = target() ?? last; last = a;
                double p = Math.Min(1, t / T), s = m.Mon.Scale;
                double apex = Math.Min(y0, a.Y) - (55 + 0.12 * Math.Abs(a.X - x0)) * s, c = 2 * apex - 0.5 * (y0 + a.Y);
                m.X = x0 + (a.X - x0) * p;
                m.Y = (1 - p) * (1 - p) * y0 + 2 * (1 - p) * p * c + p * p * a.Y;
                if (Math.Abs(a.X - x0) > 2) m.Left = a.X < x0;
                m.Pose = p < 0.35 ? "j2" : p < 0.6 ? "j3" : "j4";
                if (p < 1) return false;
                m.X = a.X; m.Y = a.Y; m.SetPerch(a.Win); phase = 2; t = 0;
            }
            int k = (int)(t / fd);
            if (k < 3) { m.Pose = "j" + (5 + k); return false; }
            m.Pose = null; m.State = St.Idle; m.Landed(m.Y - y0); return true;
        }
    }

    // Queda livre até o chão (topo de uma janela visível ou barra de tarefas), com aterrissagem J6–J8.
    class FallStep : Step
    {
        double v, t; bool landed; Floor floor;
        double y0;
        public override void Start(Mascot m) { m.State = St.Falling; m.Pose = null; m.Perch = IntPtr.Zero; v = 0; y0 = m.Y; floor = Desktop.FloorBelow((int)m.X, (int)m.Y); }
        public override bool Tick(Mascot m, double dt)
        {
            if (!landed)
            {
                v += 2600 * m.Mon.Scale * dt; m.Y += v * dt;
                if (m.Y < floor.Y) return false;
                m.Y = floor.Y; m.SetPerch(floor.Win); landed = true; t = 0; m.State = St.Jumping;
            }
            t += dt; int k = (int)(t * m.Cfg.fps.pular);
            if (k < 3) { m.Pose = "j" + (5 + k); return false; }
            m.Pose = null; m.State = St.Idle; return true;
        }
    }

    // ACTING: abre o app da allowlist (anota antes quais janelas dele já existiam, para achar a nova).
    class LaunchStep : Step
    {
        public override void Start(Mascot m)
        {
            m.State = St.Acting; m.Pose = null;
            m.Snap = Desktop.Snapshot(m.CtxApp);
            try { Actions.Launch(m.CtxApp, m.CtxUrl, m.CtxFile, m.Cfg, m.CtxRoot); }
            catch (Exception e) { m.Fail("Não consegui abrir " + m.CtxApp.nome + ": " + e.Message); }
        }
        public override bool Tick(Mascot m, double dt) { return true; }
    }

    // Espera a janela do app aparecer (nova, de preferência). Sem janela nova no prazo, usa uma janela já aberta do app.
    class WaitWindowStep : Step
    {
        readonly double timeout; double t, poll;
        public WaitWindowStep(double seconds) { timeout = seconds; }
        public override void Start(Mascot m) { m.State = St.Acting; t = 0; poll = 1; }
        public override bool Tick(Mascot m, double dt)
        {
            t += dt; poll += dt;
            if (poll < 0.15 && t < timeout) return false;
            poll = 0;
            var mine = Desktop.List().Where(w => Desktop.Matches(w, m.CtxApp)).ToList();
            var fresh = mine.FirstOrDefault(w => !m.Snap.Contains(w.H));
            // Arquivo aberto numa janela que já existia (ex.: VS Code já com a pasta Jarvis Code): acha pelo título.
            if (fresh == null && m.CtxFile != null) fresh = mine.FirstOrDefault(w => (w.Title ?? "").IndexOf(Path.GetFileName(m.CtxFile), StringComparison.OrdinalIgnoreCase) >= 0);
            if (fresh != null) { m.Ctx = fresh.H; Log.Write("janela apareceu: " + fresh.Title + " " + fresh.R); return true; }
            if (t < timeout) return false;
            if (mine.Count > 0) { m.Ctx = mine[0].H; Log.Write("usando janela existente: " + mine[0].Title); return true; }
            m.Fail("A janela de " + m.CtxApp.nome + " não apareceu."); return true;
        }
    }

    // Leva a janela do app para o monitor pedido e maximiza; espera um instante para ela assentar antes do pulo.
    class MoveToMonitorStep : Step
    {
        readonly Monitor mon; double t;
        public MoveToMonitorStep(Monitor m) { mon = m; }
        public override void Start(Mascot m)
        {
            m.State = St.Acting; t = 0;
            if (Desktop.Usable(m.Ctx)) { Desktop.MoveToMonitor(m.Ctx, mon); Log.Write("janela levada para o monitor " + mon.Area); }
        }
        public override bool Tick(Mascot m, double dt) { t += dt; return t >= 0.45; }
    }

    class FocusStep : Step
    {
        public override void Start(Mascot m) { m.State = St.Acting; if (Desktop.Usable(m.Ctx)) Desktop.BringToFront(m.Ctx); }
        public override bool Tick(Mascot m, double dt) { return true; }
    }

    // WRITING: grava o arquivo aos poucos (como se digitasse); o VS Code recarrega e mostra cada trecho chegando.
    // Nenhuma tecla é enviada: se você mexer em outra janela, nada vai parar no lugar errado.
    // Cancelado (arrastar, ação nova, falha)? Flush grava o resto de uma vez: o arquivo nunca fica pela metade.
    class WriteStep : Step, IFlushable
    {
        readonly string file, text; double pos, speed, flushT, failT; int written = -1; bool done;
        public WriteStep(string f, string t) { file = f; text = t.Replace("\r\n", "\n").Replace("\n", "\r\n"); }
        public override void Start(Mascot m)
        {
            m.State = St.Writing; m.Pose = null; pos = 0; flushT = 0;
            speed = Math.Max(m.Cfg.velocidadeEscrita ?? 90, text.Length / (m.Cfg.escritaMaxSegundos ?? 40));   // arquivo grande: acelera
            Log.Write(string.Format("escrevendo {0} ({1} caracteres, {2:0} por segundo)", Path.GetFileName(file), text.Length, speed));
        }
        public override bool Tick(Mascot m, double dt)
        {
            if (done) return true;
            m.FollowPerch();
            pos = Math.Min(text.Length, pos + speed * dt); flushT += dt;
            if (flushT < 0.12 && pos < text.Length) return false;   // ~8 gravações por segundo
            flushT = 0;
            int n = (int)pos; if (n > 0 && n < text.Length && char.IsHighSurrogate(text[n - 1])) n--;
            if (n != written)
            {
                if (Save(n)) { written = n; failT = 0; }
                else if ((failT += 0.12) > 4) { m.Fail("Não consegui gravar " + Path.GetFileName(file) + "."); return true; }
            }
            if (written < text.Length) return false;
            done = true; Log.Write("arquivo escrito: " + file); return true;
        }
        bool Save(int n)
        {
            try { File.WriteAllText(file, text.Substring(0, n), new UTF8Encoding(false)); return true; }
            catch (IOException) { return false; }                 // o VS Code pode estar lendo bem nessa hora: tenta de novo
            catch (UnauthorizedAccessException) { return false; }
        }
        public void Flush()
        {
            if (done) return; done = true;
            for (int i = 0; i < 6 && !Save(text.Length); i++) System.Threading.Thread.Sleep(80);
            Log.Write("escrita completada de uma vez: " + Path.GetFileName(file));
        }
    }

    // Comemoração: pulinhos no lugar (girando para um lado e para o outro), em cima da janela ou no chão.
    class CelebrateStep : Step
    {
        readonly int hops; int k; double t, baseY; const double Dur = 0.42;
        public CelebrateStep(int n) { hops = n; }
        public override void Start(Mascot m) { m.State = St.Jumping; t = 0; k = 0; baseY = m.Y; Log.Write("comemorando"); }
        public override bool Tick(Mascot m, double dt)
        {
            t += dt;
            if (m.Perch != IntPtr.Zero) { m.FollowPerch(); baseY = m.Y; }   // a janela pode mexer no meio
            if (t >= Dur) { t -= Dur; k++; m.Left = !m.Left; if (k >= hops) { m.Y = baseY; m.Pose = null; m.State = St.Idle; return true; } }
            double p = t / Dur, h = 34 * m.Mon.Scale;
            m.Y = baseY - 4 * h * p * (1 - p);   // arco de parábola
            m.Pose = p < 0.12 ? "j1" : p < 0.4 ? "j2" : p < 0.6 ? "j3" : p < 0.88 ? "j4" : "j6";
            return false;
        }
    }

    // Anda em cima da janela em que está (o alvo é a distância da borda esquerda dela).
    class PerchWalkStep : Step
    {
        readonly double to;
        public PerchWalkStep(double offset) { to = offset; }
        public override void Start(Mascot m) { m.State = St.Walking; m.Pose = null; }
        public override bool Tick(Mascot m, double dt)
        {
            if (m.Perch == IntPtr.Zero || !Desktop.Usable(m.Perch)) { m.State = St.Idle; return true; }   // a janela sumiu: o Idle cuida da queda
            double dx = to - m.PerchOff, step = m.Cfg.velocidadeAndar * 0.6 * m.Mon.Scale * dt;   // passeio: mais devagar
            if (Math.Abs(dx) > 0.5) m.Left = dx < 0;
            if (Math.Abs(dx) <= step) { m.PerchOff = to; m.FollowPerch(); m.State = St.Idle; return true; }
            m.PerchOff += Math.Sign(dx) * step; m.FollowPerch();
            return false;
        }
    }

    // Mexe no notebook por um tempo (brincadeira do modo Talk).
    class DoodleStep : Step
    {
        readonly double secs; double t;
        public DoodleStep(double s) { secs = s; }
        public override void Start(Mascot m) { m.State = St.Idle; m.Pose = null; m.Doodle = true; t = 0; }
        public override bool Tick(Mascot m, double dt) { m.FollowPerch(); t += dt; if (t < secs) return false; m.Doodle = false; return true; }
    }

    // Gesto no lugar (acenar, cumprimentar): toca a animação por alguns segundos e volta ao normal.
    class GestureStep : Step
    {
        readonly string anim; readonly double secs; double t;
        public GestureStep(string a, double s) { anim = a; secs = s; }
        public override void Start(Mascot m) { m.State = St.Idle; m.Pose = "@" + anim; m.ResetAnim(); t = 0; }
        public override bool Tick(Mascot m, double dt) { t += dt; if (t < secs) return false; m.Pose = null; return true; }
    }

    // Saída: tchau rápido, agacha, pula para cima e some esmaecendo no ar (o contrário de chegar).
    class VanishStep : Step
    {
        double t, y0;
        public override void Start(Mascot m) { m.State = St.Idle; m.Pose = "@acenar"; m.ResetAnim(); t = 0; y0 = m.Y; }
        public override bool Tick(Mascot m, double dt)
        {
            t += dt;
            if (t < 1.1) return false;                                   // tchau
            if (t < 1.35) { m.Pose = t < 1.22 ? "j0" : "j1"; return false; }  // agacha
            double u = Math.Min(1, (t - 1.35) / 0.55), e = 1 - Math.Pow(1 - u, 3);
            m.Pose = u < 0.5 ? "j2" : "j3";
            m.Y = y0 - e * m.BodyHeight * 1.6;                          // sobe
            m.SetFade(1 - u * u);                                        // e some no ar
            if (u < 1) return false;
            m.Pose = null; m.Y = y0; m.SetFade(1); m.VanishDone();
            return true;
        }
    }

    // Espera uma janela aparecer (no máximo "secs" segundos; sem ela, segue e o pulo desiste sozinho).
    class WaitForStep : Step
    {
        readonly Func<IntPtr> win; readonly double secs; double t;
        public WaitForStep(Func<IntPtr> w, double s) { win = w; secs = s; }
        public override void Start(Mascot m) { m.State = St.Idle; m.Pose = null; t = 0; }
        public override bool Tick(Mascot m, double dt) { t += dt; var h = win(); return (h != IntPtr.Zero && Desktop.Usable(h)) || t >= secs; }
    }

    class SkinStep : Step
    {
        readonly bool post;
        public SkinStep(bool p) { post = p; }
        public override void Start(Mascot m) { m.Postman = post; }
        public override bool Tick(Mascot m, double dt) { return true; }
    }

    class DoneStep : Step
    {
        public override void Start(Mascot m) { Log.Write("ação concluída"); m.Finish("ok", ""); m.State = St.Idle; m.Pose = null; }
        public override bool Tick(Mascot m, double dt) { return true; }
    }

    class PauseStep : Step
    {
        readonly double secs; double t;
        public PauseStep(double s) { secs = s; }
        public override void Start(Mascot m) { m.State = St.Idle; m.Pose = null; t = 0; }
        public override bool Tick(Mascot m, double dt) { t += dt; return t >= secs; }
    }

    class EndWanderStep : Step
    {
        public override void Start(Mascot m) { m.Wandering = false; m.State = St.Idle; m.Pose = null; Log.Write("ocioso: passeio terminou"); }
        public override bool Tick(Mascot m, double dt) { return true; }
    }

    class HoldThinkStep : Step
    {
        readonly double secs; double t;
        public HoldThinkStep(double s) { secs = s; }
        public override void Start(Mascot m) { m.State = St.Thinking; m.Pose = null; t = 0; }
        public override bool Tick(Mascot m, double dt) { t += dt; if (t < secs) return false; m.State = St.Idle; return true; }
    }
}
