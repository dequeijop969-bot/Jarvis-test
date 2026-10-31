// Controle do PC (Windows): volume, mudo, brilho, bloquear a tela, bateria e desligar/reiniciar agendado.
// Tudo por comandos fixos do próprio Windows (PowerShell e shutdown.exe), sem nada vindo do texto do usuário além de
// números validados. Desligar e reiniciar só depois de confirmação (ação "pc_power").
import { execFile } from 'node:child_process';

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s%]/g, ' ').replace(/\s+/g, ' ').trim();
function ps(script, ms = 9000) {
  return new Promise((ok, fail) => {
    if (process.platform !== 'win32') return fail(Object.assign(new Error('O controle do PC só funciona no Windows.'), { code: 501 }));
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: ms, windowsHide: true }, (e, out, err) => e ? fail(Object.assign(new Error(String(err || e.message).trim().slice(0, 200)), { code: 500 })) : ok(String(out).trim()));
  });
}
function run(file, args) {
  return new Promise((ok, fail) => execFile(file, args, { timeout: 8000, windowsHide: true }, e => e ? fail(Object.assign(new Error('O Windows recusou o comando.'), { code: 500 })) : ok()));
}

// Volume do Windows pela API de áudio do sistema (Core Audio), via C# embutido no PowerShell.
const AUDIO = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext); int j(); int GetMasterVolumeLevelScalar(out float pfLevel); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext); int GetMute(out bool pbMute); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class JarvisAudio {
  static IAudioEndpointVolume Vol() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d = null; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); IAudioEndpointVolume v = null; var id = typeof(IAudioEndpointVolume).GUID; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v; }
  public static float Get() { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void Set(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty)); }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void Mute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, System.Guid.Empty)); }
}
'@
`;
export async function volume() { const o = await ps(`${AUDIO}; [math]::Round([JarvisAudio]::Get()*100); [JarvisAudio]::Muted()`); const [v, m] = o.split(/\r?\n/); return { volume: Number(v), muted: /true/i.test(m || '') }; }
export async function setVolume(n) { const v = Math.max(0, Math.min(100, Math.round(Number(n)))); if (!Number.isFinite(v)) throw new Error('volume inválido'); await ps(`${AUDIO}; [JarvisAudio]::Mute($false); [JarvisAudio]::Set(${v / 100})`); return v; }
export async function changeVolume(delta) { const cur = (await volume()).volume; return setVolume(cur + delta); }
export async function mute(on) { await ps(`${AUDIO}; [JarvisAudio]::Mute($${on ? 'true' : 'false'})`); return on; }
export async function brightness(n) {
  const cur = Number(await ps('(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness').catch(() => NaN));
  if (!Number.isFinite(cur)) throw Object.assign(new Error('Este monitor não deixa ajustar o brilho pelo Windows (só notebooks e alguns monitores).'), { code: 501 });
  const v = Math.max(5, Math.min(100, Math.round(typeof n === 'number' ? n : cur + (n === 'up' ? 15 : -15))));
  await ps(`(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=${v}} | Out-Null`);
  return v;
}
export const lock = () => run('rundll32.exe', ['user32.dll,LockWorkStation']);
export async function battery() {
  const o = await ps('$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { "$($b.EstimatedChargeRemaining);$($b.BatteryStatus);$($b.EstimatedRunTime)" }');
  if (!o) return null;
  const [pct, st, mins] = o.split(';').map(Number);
  return { pct, charging: [2, 6, 7, 8, 9].includes(st), minutes: mins > 0 && mins < 10000 ? mins : null };
}
export async function power(op, minutes) {
  const sec = Math.max(0, Math.min(24 * 3600, Math.round((minutes || 0) * 60)));
  if (op === 'cancelar') return run('shutdown.exe', ['/a']).catch(() => { throw Object.assign(new Error('Não havia desligamento agendado.'), { code: 404 }); });
  return run('shutdown.exe', [op === 'reiniciar' ? '/r' : '/s', '/t', String(sec), '/c', `O JARVIS vai ${op === 'reiniciar' ? 'reiniciar' : 'desligar'} o PC. Para cancelar, diga "cancela o desligamento".`]);
}

// Entende o pedido. Devolve { op, arg } ou null.
const NUMW = { dez: 10, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cinco: 5, quinze: 15, um: 1, dois: 2, tres: 3 };
const num = s => { if (s == null) return null; if (/^\d+$/.test(s)) return Number(s); return NUMW[s] ?? null; };
export function parse(text) {
  const t = fold(text).replace(/^(jarvis|ei|por favor) /, '');
  if (/\b(da musica|do spotify)\b/.test(t)) return null;   // volume da música é com o Spotify
  if (/\bcancela(r)? (o )?(desligamento|reinicio|reinicializacao)\b|\bnao (desliga|reinicia) mais\b/.test(t)) return { op: 'power', arg: { op: 'cancelar' } };
  const pw = t.match(/\b(desliga|desligar|reinicia|reiniciar)\b (o )?(pc|computador|maquina|notebook)\b(?:.*?\b(?:em|daqui a|daqui|dentro de) (\d+|\w+) (minutos?|horas?))?/);
  if (pw) { const n = num(pw[4]); return { op: 'power', arg: { op: /reinici/.test(pw[1]) ? 'reiniciar' : 'desligar', minutes: n == null ? 1 : /hora/.test(pw[5]) ? n * 60 : n } }; }
  if (/\b(bloqueia|bloquear|trava|travar) (a )?(tela|o pc|o computador)\b/.test(t)) return { op: 'lock' };
  if (/\b(bateria|carga do notebook|quanto (de bateria|tem de carga))\b/.test(t)) return { op: 'battery' };
  if (/\b(tira|desliga|tirar)( o)? mudo\b|\bdesmuta\b|\bvolta (o )?som\b/.test(t)) return { op: 'mute', arg: false };
  if (/\b(muta|mutar|silencia|silenciar|coloca no mudo|poe no mudo|deixa no mudo|modo mudo)\b/.test(t) && !/\bmicrofone\b/.test(t)) return { op: 'mute', arg: true };
  const vs = t.match(/\bvolume( do pc| do computador| do sistema| geral)?( em| pra| para| no| a)? (\d{1,3}|\w+)( ?%| por cento)?\b/);
  if (vs && num(vs[3]) != null) return { op: 'volume', arg: num(vs[3]) };
  if (/\b(aumenta|sobe|aumentar)( o)? (volume|som)\b|\bmais (alto|volume)\b/.test(t)) return { op: 'volume', arg: 'up' };
  if (/\b(abaixa|diminui|baixa|abaixar|diminuir)( o)? (volume|som)\b|\bmais baixo\b/.test(t)) return { op: 'volume', arg: 'down' };
  if (/\b(qual|quanto) (esta |ta )?(o )?volume\b/.test(t)) return { op: 'volume', arg: 'get' };
  const br = t.match(/\bbrilho( da tela)?( em| pra| para| no| a)? (\d{1,3}|\w+)( ?%| por cento)?\b/);
  if (br && num(br[3]) != null) return { op: 'brightness', arg: num(br[3]) };
  if (/\b(aumenta|sobe)( o)? brilho\b/.test(t)) return { op: 'brightness', arg: 'up' };
  if (/\b(abaixa|diminui|baixa)( o)? brilho\b/.test(t)) return { op: 'brightness', arg: 'down' };
  return null;
}
