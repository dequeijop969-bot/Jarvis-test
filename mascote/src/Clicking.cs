// Clique pedido pelo Jarvis (modo Code: "abre o YouTube e escolhe um vídeo pra gente ver").
// O Jarvis manda o ponto (0–1000) dentro da ÚLTIMA foto que o Jarvis Code tirou. Antes de clicar ele confere:
//   - a foto é recente e foi ele que tirou (id);
//   - o ponto não cai numa janela de segurança do Windows (aviso de administrador, senha, Segurança do Windows);
//   - nada está por cima (ex.: a janela flutuante do Jarvis).
// UM clique esquerdo por pedido. O cursor volta para onde estava.
using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace JarvisDesktop
{
    static class Mouse
    {
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
        [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
        [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PT p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out PT p);
        const uint MOVE = 0x1, LEFTDOWN = 0x2, LEFTUP = 0x4, ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000;

        // Janela de topo que está visível nesse ponto da tela.
        public static IntPtr RootAt(int x, int y) { var h = WindowFromPoint(new PT { X = x, Y = y }); return h == IntPtr.Zero ? h : GetAncestor(h, 2 /* GA_ROOT */); }

        static INPUT M(int x, int y, uint flags)
        {
            var vs = SystemInformation.VirtualScreen;
            var i = new INPUT { type = 0 };
            i.u.mi = new MOUSEINPUT { dx = (int)Math.Round((x - vs.Left) * 65535.0 / Math.Max(1, vs.Width - 1)), dy = (int)Math.Round((y - vs.Top) * 65535.0 / Math.Max(1, vs.Height - 1)), dwFlags = flags | MOVE | ABSOLUTE | VIRTUALDESK };
            return i;
        }
        // Move, aperta, solta e devolve o cursor, tudo num lote só (o Windows processa em ordem).
        public static void Click(int x, int y)
        {
            PT old; GetCursorPos(out old);
            var k = new[] { M(x, y, 0), M(x, y, LEFTDOWN), M(x, y, LEFTUP), M(old.X, old.Y, 0) };
            SendInput((uint)k.Length, k, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void DoubleClick(int x, int y)
        {
            PT old; GetCursorPos(out old);
            var k = new[] { M(x, y, 0), M(x, y, LEFTDOWN), M(x, y, LEFTUP), M(x, y, LEFTDOWN), M(x, y, LEFTUP), M(old.X, old.Y, 0) };
            SendInput((uint)k.Length, k, Marshal.SizeOf(typeof(INPUT)));
        }
        // Roda do mouse sobre o ponto (notches > 0 = para cima). O cursor volta para onde estava.
        public static void Wheel(int x, int y, int notches)
        {
            PT old; GetCursorPos(out old);
            var w = M(x, y, 0); w.u.mi.dwFlags = 0x0800 /* WHEEL */ | MOVE | ABSOLUTE | VIRTUALDESK; w.u.mi.mouseData = unchecked((uint)(notches * 120));
            var k = new[] { M(x, y, 0), w, M(old.X, old.Y, 0) };
            SendInput((uint)k.Length, k, Marshal.SizeOf(typeof(INPUT)));
        }

        public static string ProcName(IntPtr h)
        {
            uint pid; W.GetWindowThreadProcessId(h, out pid);
            try { using (var p = Process.GetProcessById((int)pid)) return p.ProcessName; } catch { return ""; }
        }
        // Pode clicar em qualquer app, menos nas janelas de segurança do Windows
        // (aviso de administrador, pedido de senha/credencial, tela de login, Segurança do Windows).
        static readonly string[] Protected = { "consent", "CredentialUIBroker", "LogonUI", "SecHealthUI", "UserAccountControlSettings" };
        public static bool IsClickable(Config cfg, IntPtr root)
        {
            string pn = ProcName(root);
            return pn.Length > 0 && !Protected.Any(p => p.Equals(pn, StringComparison.OrdinalIgnoreCase));
        }
    }

    // Agacha perto do ponto, confere de novo, traz o navegador para a frente e clica.
    class ClickStep : Step
    {
        readonly int x, y; readonly IntPtr root; readonly bool dbl; double t; bool clicked;
        public ClickStep(int px, int py, IntPtr win, bool doubleClick = false) { x = px; y = py; root = win; dbl = doubleClick; }
        public override void Start(Mascot m) { m.State = St.Acting; m.Pose = "j1"; t = 0; if (W.IsWindow(root)) Desktop.BringToFront(root); }
        public override bool Tick(Mascot m, double dt)
        {
            t += dt;
            if (!clicked && t >= 0.35)
            {
                clicked = true;
                var now = Mouse.RootAt(x, y);
                if (now != root || !Mouse.IsClickable(m.Cfg, now)) { m.Fail("O ponto mudou (a janela mudou ou algo ficou por cima)."); return true; }
                if (dbl) Mouse.DoubleClick(x, y); else Mouse.Click(x, y);
                Log.Write(string.Format("clique{0} em {1},{2} ({3})", dbl ? " duplo" : "", x, y, W.Text(root)));
                m.Pose = "j6";
            }
            if (t < 0.7) return false;
            m.Finish("ok", ""); m.Pose = null; return true;
        }
    }

    // Rola a lista/página sob o ponto (sem pular até lá: é rápido e não cobre nada).
    class ScrollStep : Step
    {
        readonly int x, y, notches; readonly IntPtr root; double t; bool done;
        public ScrollStep(int px, int py, IntPtr win, int n) { x = px; y = py; root = win; notches = n; }
        public override void Start(Mascot m) { m.State = St.Acting; m.Pose = "j1"; t = 0; }
        public override bool Tick(Mascot m, double dt)
        {
            t += dt;
            if (!done && t >= 0.2)
            {
                done = true;
                var now = Mouse.RootAt(x, y);
                if (now != root || !Mouse.IsClickable(m.Cfg, now)) { m.Fail("O ponto mudou (a janela mudou ou algo ficou por cima)."); return true; }
                Mouse.Wheel(x, y, notches);
                Log.Write(string.Format("rolar {0} em {1},{2} ({3})", notches, x, y, W.Text(root)));
            }
            if (t < 0.5) return false;
            m.Finish("ok", ""); m.Pose = null; m.State = St.Idle; return true;
        }
    }

    // Teclado nas tarefas: só na janela que está na frente, e só se ela não for do Windows-segurança nem do próprio Jarvis.
    // Se a janela da frente mudar no meio da digitação, para na hora (nenhuma letra vai para outro lugar).
    static class KeyGuard
    {
        public static string Check(Config cfg, out IntPtr fg)
        {
            fg = W.GetForegroundWindow();
            if (fg == IntPtr.Zero) return "nenhuma janela na frente";
            uint pid; W.GetWindowThreadProcessId(fg, out pid);
            if (pid == (uint)Process.GetCurrentProcess().Id) return "a janela da frente é a do próprio Jarvis";
            if (!Mouse.IsClickable(cfg, fg)) return "a janela da frente é de segurança do Windows";
            return null;
        }
    }

    class KeyStep : Step
    {
        readonly string key; double t; bool done;
        public KeyStep(string k) { key = k; }
        public override void Start(Mascot m) { m.State = St.Acting; m.Pose = "j1"; t = 0; }
        public override bool Tick(Mascot m, double dt)
        {
            t += dt;
            if (!done && t >= 0.15)
            {
                done = true; IntPtr fg; var why = KeyGuard.Check(m.Cfg, out fg);
                if (why != null) { m.Fail(why); return true; }
                Kbd.Combo(key); Log.Write("tecla " + key + " em " + W.Text(fg));
            }
            if (t < 0.4) return false;
            m.Finish("ok", ""); m.Pose = null; m.State = St.Idle; return true;
        }
    }

    // Jogar: segura as teclas por alguns ms e solta. Trava na janela do jogo: a 1ª jogada marca a janela da frente;
    // se depois a janela da frente for outra (você trocou de app), recusa e o Jarvis para de jogar.
    class HoldStep : Step, IFlushable
    {
        public static IntPtr GameWin = IntPtr.Zero;
        readonly ushort[] vks; readonly double secs; readonly bool first; double t; bool down, done;
        public HoldStep(ushort[] k, int ms, bool inicio) { vks = k; secs = ms / 1000.0; first = inicio; }
        public override void Start(Mascot m) { m.State = St.Acting; m.Pose = "j1"; t = 0; }
        public override bool Tick(Mascot m, double dt)
        {
            t += dt;
            if (!down)
            {
                IntPtr fg; var why = KeyGuard.Check(m.Cfg, out fg);
                if (why == null && first) GameWin = fg;
                else if (why == null && fg != GameWin) why = "a janela da frente mudou (não é mais o jogo)";
                if (why != null) { m.Fail(why); return true; }
                Kbd.GameDown(vks); down = true; t = 0;
                return false;
            }
            if (!done && t >= secs) { Kbd.GameUp(vks); done = true; }
            if (!done) return false;
            m.Finish("ok", ""); m.Pose = null; m.State = St.Idle; return true;
        }
        public void Flush() { if (down && !done) { Kbd.GameUp(vks); done = true; } }   // cancelado no meio (arrastar, ação nova): nunca deixa tecla presa
    }

    class TextStep : Step
    {
        readonly string text; readonly bool enter; int pos; double budget, t; IntPtr win;
        public TextStep(string s, bool e) { text = s; enter = e; }
        public override void Start(Mascot m) { m.State = St.Writing; m.Pose = null; }
        public override bool Tick(Mascot m, double dt)
        {
            t += dt;
            if (t < 0.15) return false;
            IntPtr fg; var why = KeyGuard.Check(m.Cfg, out fg);
            if (why == null && win != IntPtr.Zero && fg != win) why = "a janela da frente mudou no meio da digitação";
            if (why != null) { m.Fail(why); return true; }
            if (win == IntPtr.Zero) { win = fg; Log.Write("digitando " + text.Length + " caracteres em " + W.Text(fg)); }
            budget += 30 * dt;   // ~30 letras por segundo
            while (budget >= 1 && pos < text.Length)
            {
                char c = text[pos];
                if (char.IsHighSurrogate(c) && pos + 1 < text.Length) { Kbd.Pair(c, text[pos + 1]); pos++; } else Kbd.Char(c);
                pos++; budget -= 1;
            }
            if (pos < text.Length) return false;
            if (enter) Kbd.Enter();
            m.Finish("ok", ""); m.State = St.Idle; return true;
        }
    }
}
