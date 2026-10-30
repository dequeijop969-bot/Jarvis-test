// Execução de ações com ALLOWLIST: só abre apps listados no config.json. Nada arbitrário vindo da IA:
// o Jarvis manda um "alvo" (nome/apelido) e, no caso de site, uma URL https que é validada aqui de novo.
// Escrever (modo Code): só um arquivo de código/texto direto na pasta Jarvis Code, com nome simples. Nenhuma tecla é enviada.
using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;

namespace JarvisDesktop
{
    static class Actions
    {
        static readonly Regex SafeUrl = new Regex(@"^https://[^\s""'<>^`{|}\\]{3,2000}$");
        // Mesmas extensões do servidor (lib/codewriter.js): nada executável no clique duplo (.bat, .cmd, .ps1, .vbs, .exe...).
        static readonly Regex SafeCodeName = new Regex(@"^[a-z0-9_-]{1,48}\.(html|htm|css|js|mjs|ts|jsx|tsx|json|md|txt|py|java|c|cpp|cs|go|rs|php|rb|kt|swift|sql|xml|svg|yaml|yml|lua|dart|vue)$");
        public const int MaxCodeChars = 200000;

        public static bool ValidUrl(string url) { return url != null && SafeUrl.IsMatch(url); }

        // O arquivo fica DIRETAMENTE na pasta Jarvis Code e tem nome/extensão seguros?
        // Pasta de projeto escolhida pelo usuário no Jarvis (Integrações / janela flutuante): arquivos de código em qualquer subpasta.
        static readonly Regex ProjectName = new Regex(@"^[\w .()-]{1,80}\.(html|htm|css|scss|js|mjs|cjs|ts|jsx|tsx|json|md|txt|py|java|c|h|cpp|hpp|cs|go|rs|php|rb|kt|swift|sql|xml|svg|yaml|yml|lua|dart|vue|svelte|sh|toml|ini)$", RegexOptions.IgnoreCase);
        // A pasta que o Jarvis mandou vale? Caminho completo, existe, e nunca Windows, Arquivos de Programas, AppData ou a raiz do disco.
        public static string ProjectRoot(string pasta)
        {
            if (string.IsNullOrEmpty(pasta) || pasta.IndexOf('"') >= 0 || !Path.IsPathRooted(pasta)) return null;
            try
            {
                var full = Path.GetFullPath(pasta).TrimEnd('\\');
                if (!Directory.Exists(full) || Path.GetPathRoot(full).TrimEnd('\\') == full) return null;
                foreach (var bad in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
                    if (!string.IsNullOrEmpty(bad) && (full + "\\").StartsWith(bad.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) return null;
                return full;
            }
            catch { return null; }
        }
        // root null = pasta Jarvis Code (só arquivos na raiz, nomes simples); com root = pasta de projeto (subpastas, sem ocultas nem node_modules).
        public static bool ValidCodeFile(Config cfg, string file, string root = null)
        {
            if (string.IsNullOrEmpty(file) || file.IndexOf('"') >= 0) return false;
            try
            {
                string full = Path.GetFullPath(file);
                if (root == null) return string.Equals(Path.GetDirectoryName(full), cfg.PastaCodigo.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) && SafeCodeName.IsMatch(Path.GetFileName(full));
                if (!full.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase) || !ProjectName.IsMatch(Path.GetFileName(full))) return false;
                foreach (var part in full.Substring(root.Length + 1).Split('\\'))
                    if (part.Length == 0 || part.StartsWith(".") || part.Equals("node_modules", StringComparison.OrdinalIgnoreCase)) return false;
                return true;
            }
            catch { return false; }
        }

        // Abre o app (e a URL ou o arquivo, se houver). Lança exceção com mensagem amigável se falhar.
        public static void Launch(AppEntry app, string url, string file = null, Config cfg = null, string root = null)
        {
            string args = app.argumentos ?? "";
            if (url != null)
            {
                if (!ValidUrl(url)) throw new InvalidOperationException("URL recusada (só https).");
                if (string.IsNullOrEmpty(app.argumentosUrl)) throw new InvalidOperationException(app.nome + " não abre endereços.");
                args = (args + " " + app.argumentosUrl.Replace("{url}", "\"" + url + "\"")).Trim();
            }
            else if (file != null)
            {
                if (cfg == null || !ValidCodeFile(cfg, file, root)) throw new InvalidOperationException("Arquivo recusado (fora da pasta de código).");
                if (string.IsNullOrEmpty(app.argumentosArquivo)) throw new InvalidOperationException(app.nome + " não abre arquivos.");
                args = (args + " " + app.argumentosArquivo.Replace("{pasta}", "\"" + (root ?? cfg.PastaCodigo) + "\"").Replace("{arquivo}", "\"" + Path.GetFullPath(file) + "\"")).Trim();
            }
            var psi = new ProcessStartInfo(Environment.ExpandEnvironmentVariables(app.comando), args) { UseShellExecute = true };   // resolve notepad.exe, calc.exe, chrome...
            Log.Write("abrindo " + app.nome + ": " + psi.FileName + " " + args);
            using (Process.Start(psi)) { }
        }
    }
}
