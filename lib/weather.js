// Clima pela Open-Meteo (sem chave; uso não comercial; atribuição CC BY 4.0 a Open-Meteo.com).
const WMO = {
  0: ['Céu limpo', 'o céu está limpo'], 1: ['Predomínio de sol', 'o céu está quase limpo'],
  2: ['Parcialmente nublado', 'o tempo está parcialmente nublado'], 3: ['Nublado', 'o tempo está nublado'],
  45: ['Neblina', 'há neblina'], 48: ['Neblina com geada', 'há neblina com geada'],
  51: ['Garoa fraca', 'cai uma garoa fraca'], 53: ['Garoa', 'cai uma garoa'], 55: ['Garoa forte', 'cai uma garoa forte'],
  56: ['Garoa congelante', 'cai uma garoa congelante'], 57: ['Garoa congelante forte', 'cai uma garoa congelante forte'],
  61: ['Chuva fraca', 'chove fraco'], 63: ['Chuva', 'está chovendo'], 65: ['Chuva forte', 'chove forte'],
  66: ['Chuva congelante', 'cai chuva congelante'], 67: ['Chuva congelante forte', 'cai chuva congelante forte'],
  71: ['Neve fraca', 'neva fraco'], 73: ['Neve', 'está nevando'], 75: ['Neve forte', 'neva forte'], 77: ['Grãos de neve', 'caem grãos de neve'],
  80: ['Pancadas de chuva', 'há pancadas de chuva fracas'], 81: ['Pancadas de chuva', 'há pancadas de chuva'], 82: ['Temporal', 'há pancadas de chuva fortes'],
  85: ['Pancadas de neve', 'há pancadas de neve'], 86: ['Pancadas de neve fortes', 'há pancadas de neve fortes'],
  95: ['Trovoada', 'há trovoadas'], 96: ['Trovoada com granizo', 'há trovoadas com granizo'], 99: ['Trovoada com granizo', 'há trovoadas com granizo forte']
};
export const describeCode = c => WMO[c] || ['Tempo indefinido', 'não consegui identificar a condição do tempo'];

export async function geocode(q, lang = 'pt') {
  const name = String(q || '').trim().slice(0, 80);
  if (name.length < 2) return [];
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.search = new URLSearchParams({ name, count: '6', language: lang.slice(0, 2).toLowerCase(), format: 'json' });
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('geocodificação indisponível');
  const j = await r.json();
  return (j.results || []).map(x => ({
    name: x.name, admin1: x.admin1 || '', country: x.country || '', country_code: x.country_code || '',
    latitude: x.latitude, longitude: x.longitude, timezone: x.timezone || 'auto'
  })).filter(x => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
}

const cache = new Map(); // 30 minutos
export async function currentWeather(city) {
  if (!city || !Number.isFinite(city.latitude)) return null;
  const k = `${city.latitude.toFixed(3)},${city.longitude.toFixed(3)}`, hit = cache.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: String(city.latitude), longitude: String(city.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min', timezone: city.timezone || 'auto', forecast_days: '1'
  });
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('previsão indisponível');
  const j = await r.json(), c = j.current || {};
  if (!Number.isFinite(c.temperature_2m)) throw new Error('previsão sem dados');
  const [label, phrase] = describeCode(c.weather_code);
  const v = {
    city: city.name, temp: Math.round(c.temperature_2m),
    feels: Number.isFinite(c.apparent_temperature) ? Math.round(c.apparent_temperature) : null,
    code: c.weather_code, label, phrase, is_day: c.is_day === 1,
    max: Number.isFinite(j.daily?.temperature_2m_max?.[0]) ? Math.round(j.daily.temperature_2m_max[0]) : null,
    min: Number.isFinite(j.daily?.temperature_2m_min?.[0]) ? Math.round(j.daily.temperature_2m_min[0]) : null,
    at: new Date().toISOString(), source: 'Open-Meteo.com'
  };
  cache.set(k, { v, exp: Date.now() + 30 * 60_000 });
  return v;
}

const grau = n => `${n} ${Math.abs(n) === 1 ? 'grau' : 'graus'}`;
export function weatherSpeech(w) {
  if (!w) return '';
  let s = `Em ${w.city}, ${grau(w.temp)} e ${w.phrase}.`;
  if (w.feels != null && Math.abs(w.feels - w.temp) >= 3) s += ` A sensação é de ${grau(w.feels)}.`;
  if (w.max != null && w.min != null) s += ` Máxima de ${w.max} e mínima de ${w.min}.`;
  return s;
}
export const _clearWeatherCache = () => cache.clear();
