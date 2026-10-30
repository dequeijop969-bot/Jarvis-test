// Escuta passiva do "Jarvis": reconhecimento de voz LOCAL (Vosk, Apache-2.0), nada do microfone sai do PC.
// O reconhecedor só conhece a palavra "jarvis" e algumas parecidas (java, jar, service...), que competem com ela:
// assim "Jair", "jardim" ou "jarra" não acordam o Jarvis por engano. Usa o modelo pequeno em inglês (o português
// não tem a palavra "jarvis"). Fica pausado enquanto a conversa acontece (não escuta a própria voz).
// Arquivos: mascote\vosk\ (libvosk.dll e as DLLs dela) e mascote\vosk\modelo\ (o modelo).
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace JarvisDesktop
{
    class Wake : IDisposable
    {
        public event Action Heard;   // chamado na thread de áudio: quem ouve passa para a thread da tela
        public volatile bool Paused;
        public string Status = "desligada";
        const string Grammar = "[\"jarvis\", \"hey\", \"java\", \"jar\", \"service\", \"harvest\", \"garbage\", \"travis\", \"[unk]\"]";
        const int Rate = 16000, BufBytes = 3200, NBuf = 4;   // 100 ms por bloco
        readonly string dir;
        Thread th; volatile bool stop; DateTime last = DateTime.MinValue;

        public Wake(string voskDir) { dir = voskDir; }
        public static bool Available(string voskDir) { return File.Exists(Path.Combine(voskDir, "libvosk.dll")) && Directory.Exists(Path.Combine(voskDir, "modelo")); }

        public void Start()
        {
            if (th != null) return;
            th = new Thread(Run) { IsBackground = true, Name = "escuta-jarvis" }; th.Start();
        }

        void Run()
        {
            IntPtr model = IntPtr.Zero, rec = IntPtr.Zero;
            try
            {
                V.SetDllDirectory(dir);
                V.vosk_set_log_level(-1);
                model = V.vosk_model_new(Z(Path.Combine(dir, "modelo")));
                if (model == IntPtr.Zero) { Status = "modelo não carregou"; Log.Write("escuta: modelo do Vosk não carregou em " + dir); return; }
                rec = V.vosk_recognizer_new_grm(model, Rate, Z(Grammar));
                Log.Write("escuta: pronta (diga \"Jarvis\")");
                while (!stop)
                {
                    string err = Capture(rec);   // só volta se o microfone falhar
                    if (stop) break;
                    Status = "sem microfone"; Log.Write("escuta: " + err + "; tento de novo em 20 s");
                    for (int i = 0; i < 200 && !stop; i++) Thread.Sleep(100);
                }
            }
            catch (Exception e) { Status = "erro"; Log.Write("escuta: " + e.Message); }
            finally
            {
                if (rec != IntPtr.Zero) V.vosk_recognizer_free(rec);
                if (model != IntPtr.Zero) V.vosk_model_free(model);
            }
        }

        // Microfone padrão do Windows (waveIn), 16 kHz mono 16 bits, em blocos de 100 ms.
        string Capture(IntPtr rec)
        {
            var fmt = new V.WAVEFORMATEX { wFormatTag = 1, nChannels = 1, nSamplesPerSec = Rate, wBitsPerSample = 16, nBlockAlign = 2, nAvgBytesPerSec = Rate * 2 };
            IntPtr wi;
            int r = V.waveInOpen(out wi, V.WAVE_MAPPER, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);
            if (r != 0) return "não abri o microfone (erro " + r + ")";
            int hsz = Marshal.SizeOf(typeof(V.WAVEHDR)), flagsAt = (int)Marshal.OffsetOf(typeof(V.WAVEHDR), "dwFlags"), recAt = (int)Marshal.OffsetOf(typeof(V.WAVEHDR), "dwBytesRecorded");
            var hdr = new IntPtr[NBuf]; var data = new IntPtr[NBuf]; var chunk = new byte[BufBytes];
            try
            {
                for (int i = 0; i < NBuf; i++)
                {
                    data[i] = Marshal.AllocHGlobal(BufBytes); hdr[i] = Marshal.AllocHGlobal(hsz);
                    Marshal.StructureToPtr(new V.WAVEHDR { lpData = data[i], dwBufferLength = BufBytes }, hdr[i], false);
                    V.waveInPrepareHeader(wi, hdr[i], hsz); V.waveInAddBuffer(wi, hdr[i], hsz);
                }
                if ((r = V.waveInStart(wi)) != 0) return "não comecei a gravar (erro " + r + ")";
                Status = "ouvindo";
                int idle = 0;
                while (!stop)
                {
                    bool any = false;
                    for (int i = 0; i < NBuf; i++)
                    {
                        if ((Marshal.ReadInt32(hdr[i], flagsAt) & V.WHDR_DONE) == 0) continue;
                        any = true;
                        int n = Marshal.ReadInt32(hdr[i], recAt);
                        if (n > 0 && !Paused) { Marshal.Copy(data[i], chunk, 0, n); Feed(rec, chunk, n); }
                        V.waveInUnprepareHeader(wi, hdr[i], hsz);
                        Marshal.StructureToPtr(new V.WAVEHDR { lpData = data[i], dwBufferLength = BufBytes }, hdr[i], false);
                        V.waveInPrepareHeader(wi, hdr[i], hsz); V.waveInAddBuffer(wi, hdr[i], hsz);
                    }
                    if (any) idle = 0; else if (++idle > 150) return "o microfone parou de mandar áudio";   // 3 s sem nada
                    Thread.Sleep(20);
                }
                return "parada";
            }
            finally
            {
                V.waveInReset(wi);
                for (int i = 0; i < NBuf; i++) if (hdr[i] != IntPtr.Zero) { V.waveInUnprepareHeader(wi, hdr[i], hsz); Marshal.FreeHGlobal(hdr[i]); Marshal.FreeHGlobal(data[i]); }
                V.waveInClose(wi);
            }
        }

        // Só acorda se a frase COMEÇA com "jarvis" e isso se mantém por 3 atualizações seguidas (~0,3 s), ou no resultado final.
        // Medido: numa chamada de verdade o "jarvis" vem primeiro e fica; num falso ("o Jarbas também vem") ele aparece no meio
        // da frase e some. De quebra, falar "o Jarvis" no meio de uma conversa com alguém não chama.
        int steady;
        static readonly System.Text.RegularExpressions.Regex Starts = new System.Text.RegularExpressions.Regex("\"(partial|text)\"\\s*:\\s*\"jarvis\\b");
        void Feed(IntPtr rec, byte[] chunk, int n)
        {
            bool final = V.vosk_recognizer_accept_waveform(rec, chunk, n) != 0;
            string json = Str(final ? V.vosk_recognizer_result(rec) : V.vosk_recognizer_partial_result(rec));
            bool first = Starts.IsMatch(json);
            steady = first && !final ? steady + 1 : 0;
            if (!(final && first) && steady < 3) return;
            steady = 0;
            V.vosk_recognizer_reset(rec);
            if ((DateTime.Now - last).TotalSeconds < 3) return;   // a mesma chamada não dispara duas vezes
            last = DateTime.Now;
            Log.Write("escuta: \"Jarvis\" ouvido");
            var h = Heard; if (h != null) h();
        }

        // Teste sem microfone: áudio PCM 16 kHz mono 16 bits (arquivo .raw). Devolve quantas vezes ouviu "Jarvis".
        public static int TestFile(string voskDir, string raw)
        {
            V.SetDllDirectory(voskDir); V.vosk_set_log_level(-1);
            IntPtr model = V.vosk_model_new(Z(Path.Combine(voskDir, "modelo"))), rec = V.vosk_recognizer_new_grm(model, Rate, Z(Grammar));
            var w = new Wake(voskDir); int hits = 0; w.Heard += () => hits++;
            var d = File.ReadAllBytes(raw); var c = new byte[BufBytes];
            for (int o = 0; o < d.Length; o += BufBytes) { int n = Math.Min(BufBytes, d.Length - o); Array.Copy(d, o, c, 0, n); w.Feed(rec, c, n); }
            V.vosk_recognizer_free(rec); V.vosk_model_free(model);
            return hits;
        }

        public void Dispose() { stop = true; }

        static byte[] Z(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }
        static string Str(IntPtr p) { if (p == IntPtr.Zero) return ""; int n = 0; while (Marshal.ReadByte(p, n) != 0) n++; var b = new byte[n]; Marshal.Copy(p, b, 0, n); return Encoding.UTF8.GetString(b); }
    }

    static class V
    {
        const string L = "libvosk.dll";
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool SetDllDirectory(string path);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern void vosk_set_log_level(int l);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_model_new(byte[] path);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern void vosk_model_free(IntPtr m);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_new_grm(IntPtr m, float rate, byte[] grammar);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern int vosk_recognizer_accept_waveform(IntPtr r, byte[] data, int len);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_result(IntPtr r);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_partial_result(IntPtr r);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern void vosk_recognizer_reset(IntPtr r);
        [DllImport(L, CallingConvention = CallingConvention.Cdecl)] public static extern void vosk_recognizer_free(IntPtr r);

        public const uint WAVE_MAPPER = 0xFFFFFFFF; public const int WHDR_DONE = 1;
        [StructLayout(LayoutKind.Sequential)] public struct WAVEFORMATEX { public short wFormatTag, nChannels; public int nSamplesPerSec, nAvgBytesPerSec; public short nBlockAlign, wBitsPerSample, cbSize; }
        [StructLayout(LayoutKind.Sequential)] public struct WAVEHDR { public IntPtr lpData; public int dwBufferLength, dwBytesRecorded; public IntPtr dwUser; public int dwFlags, dwLoops; public IntPtr lpNext, reserved; }
        [DllImport("winmm.dll")] public static extern int waveInOpen(out IntPtr hwi, uint dev, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, int flags);
        [DllImport("winmm.dll")] public static extern int waveInPrepareHeader(IntPtr hwi, IntPtr hdr, int size);
        [DllImport("winmm.dll")] public static extern int waveInUnprepareHeader(IntPtr hwi, IntPtr hdr, int size);
        [DllImport("winmm.dll")] public static extern int waveInAddBuffer(IntPtr hwi, IntPtr hdr, int size);
        [DllImport("winmm.dll")] public static extern int waveInStart(IntPtr hwi);
        [DllImport("winmm.dll")] public static extern int waveInReset(IntPtr hwi);
        [DllImport("winmm.dll")] public static extern int waveInClose(IntPtr hwi);
    }
}
