// Nível do som que está saindo nas caixas (o mesmo medidor da barrinha verde do mixer do Windows, Core Audio).
// O círculo do modo V usa para "falar junto" com a voz de verdade, em vez de uma animação inventada.
using System;
using System.Runtime.InteropServices;

namespace JarvisDesktop
{
    static class AudioLevel
    {
        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        }
        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice { int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface); }
        [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioMeterInformation { int GetPeakValue(out float peak); }

        static IAudioMeterInformation meter; static DateTime got = DateTime.MinValue;

        // 0 a 1. Sem placa de som ou se algo falhar, 0 (o círculo cai para a animação simples).
        public static float Peak()
        {
            try
            {
                if (meter == null || (DateTime.Now - got).TotalSeconds > 3)   // o dispositivo padrão pode trocar (fone, caixa)
                {
                    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                    IMMDevice dev; if (en.GetDefaultAudioEndpoint(0 /* render */, 1 /* multimedia */, out dev) != 0) return 0;
                    var iid = typeof(IAudioMeterInformation).GUID; object o;
                    if (dev.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o) != 0) return 0;
                    meter = (IAudioMeterInformation)o; got = DateTime.Now;
                }
                float p; return meter.GetPeakValue(out p) == 0 ? Math.Max(0, Math.Min(1, p)) : 0;
            }
            catch { meter = null; return 0; }
        }
    }
}
