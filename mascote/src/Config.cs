// config.json ao lado do .exe. Criado com valores padrão na primeira execução; caminhos relativos são à pasta do .exe.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace JarvisDesktop
{
    public class AppJanela { public List<string> processos { get; set; } public List<string> titulos { get; set; } }
    public class AppEntry
    {
        public string chave { get; set; }
        public string nome { get; set; }
        public List<string> apelidos { get; set; }   // como o Jarvis/você chama o app ("bloco de notas")
        public string comando { get; set; }           // executável ou nome registrado no Windows (notepad.exe, calc.exe, chrome)
        public string argumentos { get; set; }
        public string argumentosUrl { get; set; }     // só para navegador: "{url}" é trocado pela URL (https validada)
        public string argumentosArquivo { get; set; } // só para editor (VS Code): "{pasta}" e "{arquivo}" viram a pasta Jarvis Code e o arquivo novo
        public AppJanela janela { get; set; }         // como reconhecer a janela do app (processo e/ou trecho do título)
    }
    public class Fps { public double andar { get; set; } public double pular { get; set; } public double pensar { get; set; } public double notebook { get; set; } }
    public class Config
    {
        public string jarvisUrl { get; set; }
        public string pastaJarvis { get; set; }
        public bool iniciarServidor { get; set; }
        public bool abrirAppAoIniciar { get; set; }
        public string node { get; set; }
        public string navegadorApp { get; set; }
        public string pastaSprites { get; set; }
        public int escala { get; set; }
        public Fps fps { get; set; }
        public double velocidadeAndar { get; set; }
        public List<int> pensarEntrada { get; set; }
        public List<int> pensarLoop { get; set; }
        public string atalhoTeste { get; set; }
        public bool? permitirLerTela { get; set; }   // o Jarvis pode pedir UMA foto da janela/monitor onde o mascote está (padrão: sim)
        public bool LerTela { get { return permitirLerTela != false; } }
        public string atalhoFalar { get; set; }       // atalho global: chama o V (o mesmo que dizer "Jarvis"); com o V na tela, fecha
        public bool abrirFlutuante { get; set; }
        public double? opacidadeFlutuante { get; set; }   // 0.3 a 1: quanto a janela flutuante cobre o que está atrás (padrão 0.88)      // abre a janela flutuante ao iniciar (no lugar da janela grande)
        public double? ociosoNotebook { get; set; }   // segundos parado até pegar o notebook (0 = nunca)
        public double? ociosoPasseio { get; set; }    // segundos parado até sair andando à toa (0 = nunca)
        public bool? permitirEscrever { get; set; }   // modo Code: o Jarvis pode pedir para escrever um arquivo NOVO na pasta Jarvis Code (padrão: sim)
        public bool? manterVoz { get; set; }          // reabre o VoiceStudio (a voz do Jarvis) se ele fechar ou cair: padrão ligado; false desliga
        public bool? escutaJarvis { get; set; }       // escuta passiva do "Jarvis" (local, Vosk): padrão ligada; false desliga
        public bool? permitirClicar { get; set; }     // modo Code: o Jarvis pode pedir UM clique numa janela do navegador (padrão: sim; precisa de permitirLerTela)
        public bool PodeClicar { get { return permitirClicar != false && LerTela; } }
        public bool? permitirTeclado { get; set; }    // modo Code, tarefas: digitar o que você falou (em buscas) e apertar teclas de uma lista fixa (padrão: sim; precisa de permitirClicar)
        public bool PodeTeclado { get { return permitirTeclado != false && PodeClicar; } }
        public bool PodeEscrever { get { return permitirEscrever != false && apps.Any(a => !string.IsNullOrEmpty(a.argumentosArquivo)); } }
        public string pastaCodigo { get; set; }       // onde ficam os arquivos escritos (padrão Documentos\Jarvis Code; igual ao JARVIS_CODE_DIR do servidor)
        public string PastaCodigo { get { return Path.GetFullPath(Environment.ExpandEnvironmentVariables(string.IsNullOrEmpty(pastaCodigo) ? @"%USERPROFILE%\Documents\Jarvis Code" : pastaCodigo)); } }
        public double? velocidadeEscrita { get; set; }   // caracteres por segundo ao "digitar" no VS Code (padrão 90)
        public double? escritaMaxSegundos { get; set; }  // um arquivo grande acelera para terminar nesse tempo (padrão 40)
        public string modoEscrita { get; set; }          // "digitar" (padrão: teclas uma a uma no VS Code) ou "arquivo" (grava o arquivo em pedaços, sem teclas)
        public bool Digitar { get { return !string.Equals(modoEscrita, "arquivo", StringComparison.OrdinalIgnoreCase); } }
        public double? velocidadeDigitacao { get; set; } // caracteres por segundo digitando (padrão 55)
        public List<AppEntry> apps { get; set; }

        public static string Dir { get { return AppDomain.CurrentDomain.BaseDirectory; } }
        public static string FilePath { get { return Path.Combine(Dir, "config.json"); } }
        // Chamadas internas vão direto para 127.0.0.1: "localhost" no Windows tenta IPv6 primeiro e o Jarvis só escuta em IPv4.
        public string ApiBase { get { return jarvisUrl.Replace("://localhost", "://127.0.0.1"); } }
        public string Full(string p) { return Path.GetFullPath(Path.IsPathRooted(p) ? p : Path.Combine(Dir, p)); }

        public static Config Load()
        {
            if (!File.Exists(FilePath)) File.WriteAllText(FilePath, DefaultJson(), new UTF8Encoding(false));
            Config c;
            try { c = new JavaScriptSerializer().Deserialize<Config>(File.ReadAllText(FilePath, Encoding.UTF8)); }
            catch (Exception e) { Log.Write("config.json inválido (" + e.Message + "); usando o padrão."); c = new JavaScriptSerializer().Deserialize<Config>(DefaultJson()); }
            var d = new JavaScriptSerializer().Deserialize<Config>(DefaultJson());
            if (string.IsNullOrEmpty(c.jarvisUrl)) c.jarvisUrl = d.jarvisUrl;
            c.jarvisUrl = c.jarvisUrl.TrimEnd('/');
            if (string.IsNullOrEmpty(c.pastaJarvis)) c.pastaJarvis = d.pastaJarvis;
            if (string.IsNullOrEmpty(c.node)) c.node = "node";
            if (string.IsNullOrEmpty(c.pastaSprites)) c.pastaSprites = d.pastaSprites;
            if (c.escala < 1) c.escala = d.escala;
            if (c.fps == null) c.fps = d.fps;
            if (c.fps.andar <= 0) c.fps.andar = 10; if (c.fps.pular <= 0) c.fps.pular = 14; if (c.fps.pensar <= 0) c.fps.pensar = 6; if (c.fps.notebook <= 0) c.fps.notebook = 12;
            if (c.ociosoNotebook == null || c.ociosoNotebook < 0) c.ociosoNotebook = 60; if (c.ociosoPasseio == null || c.ociosoPasseio < 0) c.ociosoPasseio = 120;
            if (c.velocidadeAndar <= 0) c.velocidadeAndar = d.velocidadeAndar;
            if (c.pensarEntrada == null) c.pensarEntrada = d.pensarEntrada;
            if (c.pensarLoop == null || c.pensarLoop.Count == 0) c.pensarLoop = d.pensarLoop;
            c.pensarEntrada = c.pensarEntrada.Where(i => i >= 1 && i <= 8).ToList();
            c.pensarLoop = c.pensarLoop.Where(i => i >= 1 && i <= 8).ToList(); if (c.pensarLoop.Count == 0) c.pensarLoop = d.pensarLoop;
            if (string.IsNullOrEmpty(c.atalhoTeste)) c.atalhoTeste = d.atalhoTeste;
            if (c.opacidadeFlutuante == null || c.opacidadeFlutuante < 0.3 || c.opacidadeFlutuante > 1) c.opacidadeFlutuante = 0.88;
            if (string.IsNullOrEmpty(c.atalhoFalar)) c.atalhoFalar = "Ctrl+Shift+Space";
            if (c.apps == null) c.apps = d.apps;
            if (c.velocidadeEscrita == null || c.velocidadeEscrita < 5) c.velocidadeEscrita = 90;
            if (c.escritaMaxSegundos == null || c.escritaMaxSegundos < 3) c.escritaMaxSegundos = 40;
            if (c.velocidadeDigitacao == null || c.velocidadeDigitacao < 5) c.velocidadeDigitacao = 55;
            foreach (var a in c.apps)
            {
                if (a.apelidos == null) a.apelidos = new List<string>();
                if (a.janela == null) a.janela = new AppJanela();
                if (a.janela.processos == null) a.janela.processos = new List<string>();
                if (a.janela.titulos == null) a.janela.titulos = new List<string>();
            }
            return c;
        }

        // Grava um campo verdadeiro/falso no config.json sem reescrever o resto do arquivo (mantém a sua formatação).
        public static void SaveFlag(string name, bool v)
        {
            try
            {
                string t = File.ReadAllText(FilePath, Encoding.UTF8), val = v ? "true" : "false";
                var rx = new System.Text.RegularExpressions.Regex("\"" + name + "\"\\s*:\\s*(true|false)");
                t = rx.IsMatch(t) ? rx.Replace(t, "\"" + name + "\": " + val, 1) : t.Insert(t.IndexOf('{') + 1, Environment.NewLine + "  \"" + name + "\": " + val + ",");
                File.WriteAllText(FilePath, t, new UTF8Encoding(false));
            }
            catch (Exception e) { Log.Write("não consegui salvar " + name + " no config.json: " + e.Message); }
        }

        public static string Norm(string s)
        {
            var f = (s ?? "").Normalize(NormalizationForm.FormD); var b = new StringBuilder();
            foreach (var ch in f) if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) b.Append(char.ToLowerInvariant(ch));
            return string.Join(" ", b.ToString().Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries));
        }

        // Allowlist: "alvo" vindo do Jarvis só vale se bater com a chave ou um apelido daqui.
        public AppEntry Resolve(string alvo)
        {
            var n = Norm(alvo);
            return apps.FirstOrDefault(a => Norm(a.chave) == n || a.apelidos.Any(x => Norm(x) == n));
        }
        public IEnumerable<string> AllAliases()
        {
            foreach (var a in apps) { yield return Norm(a.chave); foreach (var x in a.apelidos) yield return Norm(x); }
        }

        static string DefaultJson()
        {
            string chrome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe");
            bool hasChrome = File.Exists(chrome);
            string browserCmd = hasChrome ? "chrome" : "msedge";
            return
@"{
  ""jarvisUrl"": ""http://localhost:3000"",
  ""pastaJarvis"": ""..\\jarvis"",
  ""iniciarServidor"": true,
  ""abrirAppAoIniciar"": true,
  ""node"": ""node"",
  ""navegadorApp"": """ + browserCmd + @""",
  ""pastaSprites"": ""sprites"",
  ""escala"": 2,
  ""fps"": { ""andar"": 10, ""pular"": 14, ""pensar"": 6, ""notebook"": 12 },
  ""velocidadeAndar"": 170,
  ""pensarEntrada"": [1, 2],
  ""pensarLoop"": [3, 4, 5, 6, 7, 8],
  ""atalhoTeste"": ""Ctrl+Alt+J"",
  ""atalhoFalar"": ""Ctrl+Shift+Space"",
  ""abrirFlutuante"": false,
  ""opacidadeFlutuante"": 0.88,
  ""permitirLerTela"": true,
  ""ociosoNotebook"": 60,
  ""ociosoPasseio"": 120,
  ""permitirEscrever"": true,
  ""permitirClicar"": true,
  ""permitirTeclado"": true,
  ""velocidadeEscrita"": 90,
  ""escritaMaxSegundos"": 40,
  ""modoEscrita"": ""digitar"",
  ""velocidadeDigitacao"": 55,
  ""apps"": [
    { ""chave"": ""notepad"", ""nome"": ""Bloco de Notas"", ""apelidos"": [""bloco de notas"", ""notepad""],
      ""comando"": ""notepad.exe"", ""argumentos"": """",
      ""janela"": { ""processos"": [""notepad""], ""titulos"": [] } },
    { ""chave"": ""calc"", ""nome"": ""Calculadora"", ""apelidos"": [""calculadora"", ""calc""],
      ""comando"": ""calc.exe"", ""argumentos"": """",
      ""janela"": { ""processos"": [""CalculatorApp"", ""ApplicationFrameHost"", ""calc""], ""titulos"": [""Calculadora"", ""Calculator""] } },
    { ""chave"": ""navegador"", ""nome"": ""Navegador"", ""apelidos"": [""navegador"", ""chrome"", ""google chrome"", ""edge"", ""microsoft edge""],
      ""comando"": """ + browserCmd + @""", ""argumentos"": """", ""argumentosUrl"": ""{url}"",
      ""janela"": { ""processos"": [""" + (hasChrome ? "chrome" : "msedge") + @"""], ""titulos"": [] } },
    { ""chave"": ""vscode"", ""nome"": ""VS Code"", ""apelidos"": [""vs code"", ""vscode"", ""visual studio code""],
      ""comando"": ""%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe"", ""argumentos"": """", ""argumentosArquivo"": ""{pasta} {arquivo}"",
      ""janela"": { ""processos"": [""Code""], ""titulos"": [] } },
    { ""chave"": ""steam"", ""nome"": ""Steam"", ""apelidos"": [""steam""],
      ""comando"": ""steam://open/main"", ""argumentos"": """",
      ""janela"": { ""processos"": [""steamwebhelper"", ""steam""], ""titulos"": [""Steam""] } },
    { ""chave"": ""discord"", ""nome"": ""Discord"", ""apelidos"": [""discord""],
      ""comando"": ""%LOCALAPPDATA%\\Discord\\Update.exe"", ""argumentos"": ""--processStart Discord.exe"",
      ""janela"": { ""processos"": [""Discord""], ""titulos"": [] } }
  ]
}";
        }
    }

    static class Log
    {
        static readonly object gate = new object();
        public static void Write(string msg)
        {
            try
            {
                lock (gate)
                {
                    string dir = Path.Combine(Config.Dir, "logs"); Directory.CreateDirectory(dir);
                    string f = Path.Combine(dir, "mascote.log");
                    if (File.Exists(f) && new FileInfo(f).Length > 2000000) File.Delete(f);
                    File.AppendAllText(f, DateTime.Now.ToString("HH:mm:ss.fff") + "  " + msg + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch { /* log nunca derruba o app */ }
        }
    }
}
