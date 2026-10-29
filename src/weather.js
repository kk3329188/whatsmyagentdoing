'use strict';

// The weather outside the office windows: fetched from Open-Meteo (free, no
// key) every 15 minutes for the place in ~/.whatsmyagentdoing/config.json
// ("weather": { "lat": 25.04, "lon": 121.53 }, Taipei by default; false turns
// it off). Only the coordinates are sent. Failures just leave the sky as is.

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = process.env.WMAD_CONFIG || path.join(os.homedir(), '.whatsmyagentdoing', 'config.json');
const EVERY_MS = 15 * 60_000;

// WMO weather codes -> what the windows show.
function kindOf(code) {
  if (code === 0) return { kind: 'clear', label: '晴', emoji: '☀️' };
  if (code === 1 || code === 2) return { kind: 'partly', label: '晴時多雲', emoji: '🌤️' };
  if (code === 3) return { kind: 'cloudy', label: '陰', emoji: '☁️' };
  if (code === 45 || code === 48) return { kind: 'fog', label: '霧', emoji: '🌫️' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { kind: 'rain', label: code < 60 ? '毛毛雨' : '雨', emoji: '🌧️' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: 'snow', label: '雪', emoji: '🌨️' };
  if (code >= 95) return { kind: 'storm', label: '雷雨', emoji: '⛈️' };
  return { kind: 'partly', label: '多雲', emoji: '⛅' };
}

class Weather {
  constructor({ fetcher = globalThis.fetch } = {}) {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}; } catch {}
    this.off = cfg.weather === false || process.env.WMAD_NO_WEATHER === '1' || typeof fetcher !== 'function';
    const w = cfg.weather && typeof cfg.weather === 'object' ? cfg.weather : {};
    this.lat = Number.isFinite(+w.lat) ? +w.lat : 25.04;
    this.lon = Number.isFinite(+w.lon) ? +w.lon : 121.53;
    this.fetcher = fetcher;
    this.now = null;
    this.at = 0;
    this.busy = false;
  }

  // Called with each snapshot; fetches in the background when it is time.
  tick(now = Date.now()) {
    if (this.off || this.busy || now - this.at < EVERY_MS) return this.now;
    this.busy = true;
    this.at = now;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lon}&current=weather_code,temperature_2m,is_day`;
    Promise.resolve()
      .then(() => this.fetcher(url, { signal: AbortSignal.timeout(8000) }))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const c = j && j.current;
        if (!c || c.weather_code == null) return;
        const k = kindOf(c.weather_code);
        if (!c.is_day && (k.kind === 'clear' || k.kind === 'partly')) k.emoji = k.kind === 'clear' ? '🌙' : '☁️';
        this.now = { code: c.weather_code, temp: Math.round(c.temperature_2m), day: !!c.is_day, ...k, at: Date.now() };
      })
      .catch(() => {})
      .finally(() => { this.busy = false; });
    return this.now;
  }
}

module.exports = { Weather, kindOf };
