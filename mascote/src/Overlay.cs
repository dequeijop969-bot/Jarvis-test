// Janela do mascote: sem borda, sempre no topo, transparente por pixel (UpdateLayeredWindow).
// - Cliques nas áreas transparentes passam para as janelas de baixo (o Windows faz isso sozinho com alfa 0).
// - WS_EX_NOACTIVATE: nunca rouba o foco. WS_EX_TOOLWINDOW: fora da barra de tarefas e do Alt+Tab.
using System;
using System.Windows.Forms;

namespace JarvisDesktop
{
    class Overlay : Form
    {
        public event Action<int, int> DragStart, DragMove, DragEnd;   // em pixels físicos da tela
        public event Action RightClick, Clicked;   // Clicked: clique simples (sem arrastar)
        public event Action<int> Hotkey;   // id do atalho registrado
        bool down, dragging; int downX, downY;
        int lastX = int.MinValue, lastY, lastW, lastH; IntPtr lastBmp; byte lastA = 255;
        public byte Alpha = 255;   // transparência geral do Jarvis Code (sumir esmaecendo)

        public Overlay()
        {
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
            TopMost = true; AutoScaleMode = AutoScaleMode.None; Text = "Jarvis Mascote";
        }
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= W.WS_EX_LAYERED | W.WS_EX_TOOLWINDOW | W.WS_EX_NOACTIVATE | W.WS_EX_TOPMOST; return cp; }
        }
        protected override bool ShowWithoutActivation { get { return true; } }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == W.WM_MOUSEACTIVATE) { m.Result = (IntPtr)W.MA_NOACTIVATE; return; }
            if (m.Msg == W.WM_HOTKEY) { if (Hotkey != null) Hotkey((int)m.WParam); return; }
            base.WndProc(ref m);
        }

        // Desenha o bitmap (já pré-multiplicado) com o canto superior esquerdo em (x, y).
        public void Present(IntPtr hbmp, int w, int h, int x, int y)
        {
            if (x == lastX && y == lastY && w == lastW && h == lastH && hbmp == lastBmp && Alpha == lastA) return;   // nada mudou: zero custo
            IntPtr screen = W.GetDC(IntPtr.Zero), mem = W.CreateCompatibleDC(screen), old = W.SelectObject(mem, hbmp);
            var size = new W.SIZE(w, h); var src = new W.POINT(0, 0); var dst = new W.POINT(x, y);
            var blend = new W.BLENDFUNCTION { Op = 0, Flags = 0, Alpha = Alpha, Format = 1 };
            W.UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, W.ULW_ALPHA);
            W.SelectObject(mem, old); W.DeleteDC(mem); W.ReleaseDC(IntPtr.Zero, screen);
            lastX = x; lastY = y; lastW = w; lastH = h; lastBmp = hbmp; lastA = Alpha;
        }
        public void KeepOnTop() { W.SetWindowPos(Handle, W.HWND_TOPMOST, 0, 0, 0, 0, W.SWP_NOMOVE | W.SWP_NOSIZE | W.SWP_NOACTIVATE); }

        // Arrastar: só conta como arrasto depois de mover alguns pixels (um clique simples não cancela nada).
        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right) { if (RightClick != null) RightClick(); return; }
            if (e.Button != MouseButtons.Left) return;
            W.POINT p; W.GetCursorPos(out p); down = true; dragging = false; downX = p.X; downY = p.Y; Capture = true;
        }
        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (!down) return;
            W.POINT p; W.GetCursorPos(out p);
            if (!dragging && Math.Abs(p.X - downX) + Math.Abs(p.Y - downY) > 4) { dragging = true; if (DragStart != null) DragStart(downX, downY); }
            if (dragging && DragMove != null) DragMove(p.X, p.Y);
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (!down || e.Button != MouseButtons.Left) return;
            down = false; Capture = false;
            if (dragging) { dragging = false; W.POINT p; W.GetCursorPos(out p); if (DragEnd != null) DragEnd(p.X, p.Y); }
            else if (Clicked != null) Clicked();
        }
        protected override void OnMouseCaptureChanged(EventArgs e)
        {
            base.OnMouseCaptureChanged(e);
            if (down && !Capture) { down = false; if (dragging) { dragging = false; W.POINT p; W.GetCursorPos(out p); if (DragEnd != null) DragEnd(p.X, p.Y); } }
        }
    }
}
