// Digitação no VS Code (modo Code, "modoEscrita": "digitar"): o código vai aparecendo em pedaços pequenos (até uma linha)
// colados um atrás do outro. Antes eram teclas uma a uma, centenas por segundo: o VS Code processava cada tecla
// (destaque, sugestões, servidor da linguagem) e travava em arquivos grandes. Colar é UMA edição por pedaço.
// A área de transferência do usuário é guardada antes e devolvida no fim.
// Proteções:
//   - só digita se a janela da frente for o VS Code com ESTE arquivo ativo (título "index.html - ...");
//     trocou de janela ou clicou em algo? pausa; ao voltar, foca o editor de novo (Ctrl+1) antes de seguir;
//   - a pasta Jarvis Code tem um .vscode/settings.json que desliga o que bagunçaria o texto digitado
//     (fechar tags/aspas/parênteses, indentar sozinho, sugestões, Copilot) e liga o salvamento automático;
//   - no fim confere o arquivo no disco e, se algo saiu diferente, grava o conteúdo certo (o VS Code recarrega);
//   - cancelado (arrastar, ação nova) ou sem conseguir digitar: o arquivo é completado direto no disco.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace JarvisDesktop
{
    interface IFlushable { void Flush(); }

    static class Kbd
    {
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
        const uint KEYBOARD = 1, KEYUP = 2, UNICODE = 4;
        const ushort VK_RETURN = 0x0D, VK_CONTROL = 0x11, VK_1 = 0x31;

        static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT { type = KEYBOARD }; i.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags }; return i; }
        static void Send(params INPUT[] k) { SendInput((uint)k.Length, k, Marshal.SizeOf(typeof(INPUT))); }

        // Caractere como Unicode (não depende do layout do teclado; acentos e emoji funcionam).
        public static void Char(char c) { Send(Key(0, c, UNICODE), Key(0, c, UNICODE | KEYUP)); }
        public static void Pair(char hi, char lo) { Send(Key(0, hi, UNICODE), Key(0, lo, UNICODE), Key(0, hi, UNICODE | KEYUP), Key(0, lo, UNICODE | KEYUP)); }
        public static void Enter() { Send(Key(VK_RETURN, 0, 0), Key(VK_RETURN, 0, KEYUP)); }
        // Ctrl+1 = "focar o primeiro grupo de editores" do VS Code (tira o foco do terminal, da barra lateral...).
        // Ctrl + tecla (só usado pelo Jarvis Desktop: Ctrl+V para colar o trecho, Ctrl+S para salvar).
        public static void Ctrl(ushort vk) { Send(Key(VK_CONTROL, 0, 0), Key(vk, 0, 0), Key(vk, 0, KEYUP), Key(VK_CONTROL, 0, KEYUP)); }
        public static void FocusEditor() { Send(Key(VK_CONTROL, 0, 0), Key(VK_1, 0, 0), Key(VK_1, 0, KEYUP), Key(VK_CONTROL, 0, KEYUP)); }
        // Tarefas do modo Code: SÓ as teclas desta lista (igual a KEYS em lib/agent.js do servidor). Nada de Win, Alt+F4, Delete...
        // Valor: modificadores + tecla final; setas e Page/Home/End são "estendidas".
        static readonly System.Collections.Generic.Dictionary<string, ushort[]> Allowed = new System.Collections.Generic.Dictionary<string, ushort[]>
        {
            { "enter", new ushort[] { 0x0D } }, { "esc", new ushort[] { 0x1B } }, { "tab", new ushort[] { 0x09 } }, { "shift+tab", new ushort[] { 0x10, 0x09 } },
            { "space", new ushort[] { 0x20 } }, { "backspace", new ushort[] { 0x08 } },
            { "up", new ushort[] { 0x26 } }, { "down", new ushort[] { 0x28 } }, { "left", new ushort[] { 0x25 } }, { "right", new ushort[] { 0x27 } },
            { "pageup", new ushort[] { 0x21 } }, { "pagedown", new ushort[] { 0x22 } }, { "home", new ushort[] { 0x24 } }, { "end", new ushort[] { 0x23 } },
            { "f5", new ushort[] { 0x74 } }, { "ctrl+k", new ushort[] { 0x11, 0x4B } }, { "ctrl+f", new ushort[] { 0x11, 0x46 } }, { "ctrl+l", new ushort[] { 0x11, 0x4C } },
            { "ctrl+a", new ushort[] { 0x11, 0x41 } }, { "ctrl+t", new ushort[] { 0x11, 0x54 } }, { "alt+left", new ushort[] { 0x12, 0x25 } }
        };
        public static bool IsAllowed(string name) { return name != null && Allowed.ContainsKey(name); }
        static bool Extended(ushort vk) { return vk >= 0x21 && vk <= 0x28; }
        // Aperta a combinação (modificadores descem primeiro, sobem por último).
        public static void Combo(string name)
        {
            var vks = Allowed[name]; var k = new System.Collections.Generic.List<INPUT>();
            foreach (var vk in vks) k.Add(Key(vk, 0, Extended(vk) ? 1u : 0u));
            for (int i = vks.Length - 1; i >= 0; i--) k.Add(Key(vks[i], 0, KEYUP | (Extended(vks[i]) ? 1u : 0u)));
            Send(k.ToArray());
        }
        // Jogar ("joga pra mim no WASD"): SÓ letras, números, espaço, Shift, Enter e setas (igual a GAME_KEYS em lib/gameplay.js).
        // Nada de Ctrl/Alt/Win/Esc. Vão como scan code: muitos jogos (DirectInput) ignoram tecla só por código virtual.
        [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
        public static ushort GameVk(string name)
        {
            if (string.IsNullOrEmpty(name)) return 0;
            if (name.Length == 1 && ((name[0] >= 'a' && name[0] <= 'z') || (name[0] >= '0' && name[0] <= '9'))) return (ushort)char.ToUpperInvariant(name[0]);
            switch (name)
            {
                case "space": return 0x20; case "shift": return 0x10; case "enter": return 0x0D;
                case "up": return 0x26; case "down": return 0x28; case "left": return 0x25; case "right": return 0x27;
            }
            return 0;
        }
        static INPUT GameKey(ushort vk, bool up)
        {
            uint flags = 8 | (up ? KEYUP : 0) | (Extended(vk) ? 1u : 0u);   // 8 = KEYEVENTF_SCANCODE
            return Key(0, (ushort)MapVirtualKey(vk, 0), flags);
        }
        public static void GameDown(ushort[] vks) { var k = new INPUT[vks.Length]; for (int i = 0; i < vks.Length; i++) k[i] = GameKey(vks[i], false); Send(k); }
        public static void GameUp(ushort[] vks) { var k = new INPUT[vks.Length]; for (int i = 0; i < vks.Length; i++) k[i] = GameKey(vks[i], true); Send(k); }

        // Algum botão do mouse apertado (agora ou desde a última consulta)?
        public static bool MouseClicked()
        {
            bool any = false;
            foreach (int vk in new[] { 1, 2, 4 }) { short s = GetAsyncKeyState(vk); if ((s & 0x8001) != 0) any = true; }
            return any;
        }
    }

    class TypeStep : Step, IFlushable
    {
        public const string Settings = @"// Criado pelo Jarvis Desktop: o mascote DIGITA nesta pasta, então o VS Code não pode completar nada sozinho.
// Vale só para a pasta Jarvis Code. Pode apagar se não quiser (ele cria de novo).
{
  ""editor.autoClosingBrackets"": ""never"",
  ""editor.autoClosingQuotes"": ""never"",
  ""editor.autoClosingComments"": ""never"",
  ""editor.autoSurround"": ""never"",
  ""editor.autoIndent"": ""none"",
  ""editor.formatOnType"": false,
  ""editor.formatOnPaste"": false,
  ""editor.formatOnSave"": false,
  ""editor.trimAutoWhitespace"": false,
  ""editor.quickSuggestions"": { ""other"": ""off"", ""comments"": ""off"", ""strings"": ""off"" },
  ""editor.suggestOnTriggerCharacters"": false,
  ""editor.acceptSuggestionOnEnter"": ""off"",
  ""editor.tabCompletion"": ""off"",
  ""editor.wordBasedSuggestions"": ""off"",
  ""editor.snippetSuggestions"": ""none"",
  ""editor.parameterHints.enabled"": false,
  ""editor.inlineSuggest.enabled"": false,
  ""editor.linkedEditing"": false,
  ""html.autoClosingTags"": false,
  ""html.autoCreateQuotes"": false,
  ""javascript.autoClosingTags"": false,
  ""typescript.autoClosingTags"": false,
  ""emmet.showExpandedAbbreviation"": ""never"",
  ""emmet.triggerExpansionOnTab"": false,
  ""github.copilot.enable"": { ""*"": false },
  ""files.autoSave"": ""afterDelay"",
  ""files.autoSaveDelay"": 300,
  ""files.insertFinalNewline"": false,
  ""files.trimTrailingWhitespace"": false,
  ""files.trimFinalNewlines"": false
}
";
        // Cria (só se não existir) o .vscode/settings.json da pasta Jarvis Code. Precisa existir ANTES de abrir o VS Code.
        public static void EnsureWorkspaceSettings(string dir)
        {
            string vs = Path.Combine(dir, ".vscode"), f = Path.Combine(vs, "settings.json");
            if (File.Exists(f)) return;
            Directory.CreateDirectory(vs); File.WriteAllText(f, Settings, new UTF8Encoding(false));
            Log.Write("criado " + f);
        }

        static readonly Random rng = new Random();
        readonly string file, name, text;   // text: \n como quebra de linha, tab vira 2 espaços
        int pos, phase;                     // 0 = esperando o editor ficar pronto, 1 = digitando, 2 = salvando e conferindo
        double speed, settleT, waitT, pausedT, verifyT, typedT, sincePaste;
        bool done, started, saved, clipSaved; IntPtr okWin; string userClip;
        const double PasteEvery = 0.14;     // um pedaço a cada 140 ms: o VS Code acompanha sem engasgar

        public TypeStep(string f, string t)
        {
            file = f; name = Path.GetFileName(f);
            text = t.Replace("\r\n", "\n").Replace("\r", "\n").Replace("\t", "  ");
        }
        public override void Start(Mascot m)
        {
            m.State = St.Writing; m.Pose = null;
            // Ritmo: no mínimo velocidadeDigitacao; arquivo grande acelera para terminar em escritaMaxSegundos.
            speed = Math.Max(m.Cfg.velocidadeDigitacao ?? 55, text.Length / (m.Cfg.escritaMaxSegundos ?? 40));
            if (Desktop.Usable(m.Ctx)) Desktop.BringToFront(m.Ctx);
            Log.Write(string.Format("digitando {0} ({1} caracteres, ~{2:0} por segundo)", name, text.Length, speed));
        }

        // A janela da frente é o VS Code com este arquivo ativo? (título padrão: "[● ]index.html - pasta - Visual Studio Code")
        bool Ready()
        {
            var fg = W.GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            string t = W.Text(fg).TrimStart('●', ' ');
            if (!(t == name || t.StartsWith(name + " ", StringComparison.OrdinalIgnoreCase))) return false;
            if (fg == okWin) return true;
            uint pid; W.GetWindowThreadProcessId(fg, out pid);
            try { using (var p = Process.GetProcessById((int)pid)) if (!p.ProcessName.Equals("Code", StringComparison.OrdinalIgnoreCase)) return false; }
            catch { return false; }
            okWin = fg; return true;
        }

        public override bool Tick(Mascot m, double dt)
        {
            if (done) return true;
            m.FollowPerch();
            if (phase == 0)
            {
                // Espera o VS Code ficar na frente com o arquivo (e sem cliques) por um instante, foca o editor e começa.
                if (started) pausedT += dt; else waitT += dt;
                // O VS Code foi fechado no meio: grava o arquivo completo agora (antes esperava 45 s).
                if (started && okWin != IntPtr.Zero && !W.IsWindow(okWin)) { Log.Write("VS Code fechado no meio: gravando o arquivo completo"); Flush(); return true; }
                if (Kbd.MouseClicked() || !Ready()) settleT = 0; else settleT += dt;
                if (settleT >= (started ? 0.5 : 0.8)) { Kbd.FocusEditor(); sincePaste = 0; SaveClip(); phase = 1; Log.Write(started ? "digitação retomada" : "digitação começou"); started = true; return false; }
                if (waitT > 30 || pausedT > 45)
                {
                    Log.Write(started ? "digitação pausada por tempo demais: completando o arquivo" : "o VS Code não ficou pronto para digitar: gravando o arquivo direto");
                    Flush(); return true;
                }
                return false;
            }
            if (phase == 1)
            {
                // Você clicou em algo ou trocou de janela: pausa (nenhuma tecla vai para outro lugar).
                if (Kbd.MouseClicked() || !Ready()) { phase = 0; settleT = 0; RestoreClip(); Log.Write("digitação pausada (janela/clique)"); return false; }
                typedT += dt; sincePaste += dt;
                if (sincePaste < PasteEvery) return false;
                sincePaste = 0;
                // Até onde já devia estar (ritmo levemente irregular); nunca passa do fim da linha atual.
                int target = Math.Min(text.Length, Math.Max(pos + 1, (int)(speed * typedT * (0.85 + rng.NextDouble() * 0.3))));
                int nl = text.IndexOf('\n', pos);
                int end = nl >= 0 && nl < target ? nl + 1 : target;
                if (end < text.Length && char.IsLowSurrogate(text[end])) end++;   // não corta emoji ao meio
                // A quebra de linha vai junto no pedaço (nunca Enter): assim o VS Code não indenta sozinho por cima.
                if (!Paste(text.Substring(pos, end - pos))) { Log.Write("área de transferência ocupada: tento de novo"); return false; }
                pos = end;
                if (pos >= text.Length) { phase = 2; verifyT = 0; Log.Write("digitação terminou: salvando e conferindo o arquivo"); }
                return false;
            }
            // Conferência: espera o salvamento automático e compara com o que devia estar escrito.
            verifyT += dt;
            // Salva pelo próprio VS Code (vale também em pastas de projeto, que não têm salvamento automático):
            // assim o editor não fica com alterações pendentes e fechar não pergunta nem perde nada.
            if (!saved && verifyT >= 0.4) { saved = true; if (Ready()) Kbd.Ctrl(0x53); RestoreClip(); }
            if (verifyT < 1.8) return false;
            Fix(); done = true; return true;
        }
        void SaveClip()
        {
            if (clipSaved) return;
            try { userClip = System.Windows.Forms.Clipboard.ContainsText() ? System.Windows.Forms.Clipboard.GetText() : null; } catch { userClip = null; }
            clipSaved = true;
        }
        void RestoreClip()
        {
            if (!clipSaved) return; clipSaved = false;
            try { if (userClip != null) System.Windows.Forms.Clipboard.SetText(userClip); else System.Windows.Forms.Clipboard.Clear(); } catch { }
        }
        static bool Paste(string chunk)
        {
            if (chunk.Length == 0) return true;
            try { System.Windows.Forms.Clipboard.SetText(chunk.Replace("\n", "\r\n"), System.Windows.Forms.TextDataFormat.UnicodeText); }
            catch { return false; }
            Kbd.Ctrl(0x56);   // Ctrl+V
            return true;
        }
        bool LineStartSpaces(int p) { for (int i = p - 1; i >= 0; i--) { if (text[i] == '\n') return true; if (text[i] != ' ') return false; } return true; }

        static string Norm(string s) { return (s ?? "").Replace("\r\n", "\n").TrimEnd('\n', ' '); }
        void Fix()
        {
            try
            {
                string disk = File.Exists(file) ? File.ReadAllText(file, Encoding.UTF8) : "";
                if (Norm(disk) == Norm(text)) { Log.Write("arquivo conferido: " + name); return; }
                File.WriteAllText(file, text.Replace("\n", "\r\n"), new UTF8Encoding(false));
                Log.Write("o texto digitado saiu diferente (autocompletar? tecla extra?): gravei o conteúdo certo em " + name);
            }
            catch (Exception e) { Log.Write("não consegui conferir " + name + ": " + e.Message); }
        }

        // Cancelado: para de digitar na hora e, depois do salvamento automático do que já foi digitado, completa o arquivo no disco.
        public void Flush()
        {
            if (done) return; done = true;
            RestoreClip();
            if (!started) { Fix(); return; }
            var t = new System.Windows.Forms.Timer { Interval = 1200 };
            t.Tick += (s, e) => { t.Stop(); t.Dispose(); Fix(); };
            t.Start();
        }
    }
}
