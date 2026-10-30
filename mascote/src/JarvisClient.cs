// Ligação com o Jarvis:
// - Recebe eventos em tempo real por SSE (GET /api/mascot/events): pensando_inicio, acao, concluido, erro.
//   Na conexão, o mascote informa os apelidos da sua allowlist; o Jarvis só delega o que o mascote sabe abrir.
// - Devolve o resultado de cada ação (POST /api/mascot/result): ok, cancelado, erro, nao_permitido.
// Uma thread de fundo só lê a conexão; os eventos são entregues na thread da interface (BeginInvoke).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace JarvisDesktop
{
    class JarvisClient
    {
        readonly Config cfg; readonly Control ui; readonly Action<string, Dictionary<string, object>> onEvent;
        public event Action<bool> StatusChanged;
        public event Action Outdated;   // o servidor do Jarvis no ar é de uma versão antiga (sem a rota do mascote)
        bool warnedOld;
        public bool Connected { get; private set; }
        Thread th; volatile bool stop; volatile HttpWebRequest current; readonly ManualResetEvent wake = new ManualResetEvent(false);

        public JarvisClient(Config c, Control uiThread, Action<string, Dictionary<string, object>> handler)
        {
            cfg = c; ui = uiThread; onEvent = handler;
            ServicePointManager.DefaultConnectionLimit = 8;
        }
        public void Start() { th = new Thread(Loop) { IsBackground = true, Name = "jarvis-sse" }; th.Start(); }

        void Loop()
        {
            while (!stop)
            {
                try { Listen(); }
                catch (WebException e)
                {
                    var r = e.Response as HttpWebResponse;
                    // 404: o Jarvis está no ar, mas é uma versão sem a rota do mascote (servidor antigo ainda rodando).
                    if (r != null && r.StatusCode == HttpStatusCode.NotFound && !warnedOld)
                    {
                        warnedOld = true; Log.Write("o Jarvis em execução não tem a rota do mascote (servidor antigo): reinicie o servidor");
                        var h = Outdated; if (h != null) try { ui.BeginInvoke(h); } catch { }
                    }
                    else if (!stop && Connected) Log.Write("conexão com o Jarvis caiu: " + e.Message);
                }
                catch (Exception e) { if (!stop && Connected) Log.Write("conexão com o Jarvis caiu: " + e.Message); }
                SetStatus(false);
                if (stop) break;
                wake.WaitOne(3000);   // tenta de novo a cada 3 s (acorda na hora se for para sair)
            }
        }

        void Listen()
        {
            string apps = Uri.EscapeDataString(string.Join(",", cfg.AllAliases().Distinct()));
            var req = (HttpWebRequest)WebRequest.Create(cfg.ApiBase + "/api/mascot/events?apps=" + apps + (cfg.LerTela ? "&tela=1" : "") + (cfg.PodeEscrever ? "&escrever=1" : "") + (cfg.PodeClicar ? "&clicar=1" : "") + (cfg.PodeTeclado ? "&teclado=1" : ""));
            req.Headers["x-jarvis"] = "1"; req.Accept = "text/event-stream"; req.Proxy = null;
            req.Timeout = 5000; req.ReadWriteTimeout = 60000;   // o Jarvis manda um "ping" a cada 20 s
            current = req;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            {
                SetStatus(true); Log.Write("conectado ao Jarvis em " + cfg.jarvisUrl);
                string ev = "message"; var data = new StringBuilder(); string line;
                while (!stop && (line = sr.ReadLine()) != null)
                {
                    if (line.Length == 0) { if (data.Length > 0) Dispatch(ev, data.ToString()); ev = "message"; data.Clear(); continue; }
                    if (line.StartsWith(":")) continue;                                   // comentário/ping
                    if (line.StartsWith("event:")) ev = line.Substring(6).Trim();
                    else if (line.StartsWith("data:")) { if (data.Length > 0) data.Append('\n'); data.Append(line.Substring(5).TrimStart()); }
                }
            }
        }

        void Dispatch(string ev, string json)
        {
            Dictionary<string, object> d;
            try { d = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>; } catch { d = null; }
            if (d == null) d = new Dictionary<string, object>();
            try { ui.BeginInvoke(onEvent, ev, d); } catch { /* interface já fechada */ }
        }

        void SetStatus(bool on)
        {
            if (Connected == on) return;
            Connected = on;
            var h = StatusChanged; if (h != null) try { ui.BeginInvoke(h, on); } catch { }
        }

        public void Report(string id, string status, string detail)
        {
            if (id == null || id.StartsWith("local-") || id.StartsWith("teste-")) { Log.Write("resultado " + id + ": " + status + " " + detail); return; }
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var body = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new Dictionary<string, string> { { "id", id }, { "status", status }, { "detalhe", detail ?? "" } }));
                    var req = (HttpWebRequest)WebRequest.Create(cfg.ApiBase + "/api/mascot/result");
                    req.Method = "POST"; req.ContentType = "application/json"; req.Headers["x-jarvis"] = "1"; req.Proxy = null; req.Timeout = 4000;
                    using (var s = req.GetRequestStream()) s.Write(body, 0, body.Length);
                    using (req.GetResponse()) { }
                }
                catch (Exception e) { Log.Write("não consegui avisar o Jarvis do resultado: " + e.Message); }
            });
        }

        // Avisa o Jarvis se o modo flutuante está ligado (a página principal mostra no botão Flutuante).
        public void SendState(bool flutuante)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var body = Encoding.UTF8.GetBytes("{\"flutuante\":" + (flutuante ? "true" : "false") + "}");
                    var req = (HttpWebRequest)WebRequest.Create(cfg.ApiBase + "/api/mascot/estado");
                    req.Method = "POST"; req.ContentType = "application/json"; req.Headers["x-jarvis"] = "1"; req.Proxy = null; req.Timeout = 4000;
                    using (var s = req.GetRequestStream()) s.Write(body, 0, body.Length);
                    using (req.GetResponse()) { }
                }
                catch (Exception e) { Log.Write("não consegui avisar o estado do modo flutuante: " + e.Message); }
            });
        }

        // Envia a foto pedida (ou o erro) para o Jarvis. A imagem só existe na memória durante o envio.
        public void SendCapture(string id, string dataUrl, string label, string error)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var d = new Dictionary<string, string> { { "id", id }, { "janela", label ?? "" } };
                    if (error != null) d["erro"] = error; else d["image"] = dataUrl;
                    var body = Encoding.UTF8.GetBytes(new JavaScriptSerializer { MaxJsonLength = 8000000 }.Serialize(d));
                    var req = (HttpWebRequest)WebRequest.Create(cfg.ApiBase + "/api/mascot/capture");
                    req.Method = "POST"; req.ContentType = "application/json"; req.Headers["x-jarvis"] = "1"; req.Proxy = null; req.Timeout = 8000;
                    using (var st = req.GetRequestStream()) st.Write(body, 0, body.Length);
                    using (req.GetResponse()) { }
                }
                catch (Exception e) { Log.Write("não consegui enviar a captura: " + e.Message); }
            });
        }

        public void Stop()
        {
            stop = true; wake.Set();
            try { var r = current; if (r != null) r.Abort(); } catch { }
            if (th != null) th.Join(2000);
        }
    }
}
