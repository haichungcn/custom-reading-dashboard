/**
 * Custom Reading Dashboard — Widget Store Catalog & Weather/Utility Engines (`js/widgets.js`)
 *
 * Defines the unified Widget Store catalog (both Core Workspace Panels and addable
 * Engineering/Wellness widgets) and zero-key Open-Meteo Weather Forecast + World Clock helpers.
 */

export const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Authoritative catalog of all rearrangeable, addable, and removable dashboard components.
 */
export const WIDGET_CATALOG = [
  {
    id: 'objectives',
    title: 'Daily Objectives (Big 3)',
    icon: '🎯',
    category: 'core',
    defaultZone: 'left',
    mobileSection: 'focus',
    description: 'Set up to 3 strategic outcomes for today with context, key takeaways, and connected sources.'
  },
  {
    id: 'todos',
    title: 'Tactical TODOs',
    icon: '✅',
    category: 'core',
    defaultZone: 'left',
    mobileSection: 'focus',
    description: 'Actionable daily tasks with completion progress bar, #tags, Slack promotions, and day rollover.'
  },
  {
    id: 'weather',
    title: 'Weather Forecast',
    icon: '🌤️',
    category: 'utility',
    defaultZone: 'right',
    mobileSection: 'focus',
    description: 'Live local & global weather with hourly trend, 5-day forecast, °C/°F toggle, city search, and offline resilience.'
  },
  {
    id: 'slack',
    title: 'Daily Digest & Team Pulse',
    icon: '💬',
    category: 'core',
    defaultZone: 'right',
    mobileSection: 'digest',
    description: 'Collapsible daily team & project digest feed (manual, Private GitHub Gist, or custom JSON URL), capped cleanly to 5 items by default.'
  },
  {
    id: 'bookmarks',
    title: 'Reading Queue & Bookmarks',
    icon: '📚',
    category: 'core',
    defaultZone: 'right',
    mobileSection: 'queue',
    description: 'Local-first reading inbox with tag filters, estimated read time, pinning, and 1-click TODO scheduling.'
  },
  {
    id: 'discovery',
    title: 'Discovery Stream (AI & Web RSS)',
    icon: '⚡',
    category: 'core',
    defaultZone: 'bottom',
    mobileSection: 'feed',
    description: 'Collapsible RSS & blog reader pre-loaded with Google Antigravity, Gemini, DeepMind, Claude, OpenAI, and Web.dev.'
  },
  {
    id: 'pomodoro',
    title: 'Focus Pomodoro Timer',
    icon: '⏱️',
    category: 'wellness',
    defaultZone: 'left',
    mobileSection: 'focus',
    description: 'Calm 25m / 50m deep-work sprint timer with 5m recharge breaks synced to your daily break counter.'
  },
  {
    id: 'world-clock',
    title: 'Global Chapter Clocks',
    icon: '🌍',
    category: 'utility',
    defaultZone: 'right',
    mobileSection: 'digest',
    description: 'Multi-timezone live clock strip for distributed teams (Local TZ, UTC, Americas, Europe, APAC, and custom zones).'
  },
  {
    id: 'scratchpad',
    title: 'Quick Scratchpad',
    icon: '📝',
    category: 'utility',
    defaultZone: 'left',
    mobileSection: 'focus',
    description: 'Auto-saving local-first jotter for standup notes, incident timestamps, or quick architecture thoughts.'
  },
  {
    id: 'launchpad',
    title: 'Quick Dev Launchpad',
    icon: '🚀',
    category: 'utility',
    defaultZone: 'top',
    mobileSection: 'queue',
    description: 'Configurable 1-click dock for your daily engineering tools (GitHub, GitLab, Docs, AI tools, or custom shortcuts).'
  },
  {
    id: 'habit-tracker',
    title: 'Daily Micro-Habits',
    icon: '🌱',
    category: 'wellness',
    defaultZone: 'left',
    mobileSection: 'focus',
    description: 'Gentle daily check-offs for hydration, deep-work blocks, outdoor daylight, and shutting down on time.'
  },
  {
    id: 'system-pulse',
    title: 'System & Sync Telemetry',
    icon: '🖥️',
    category: 'utility',
    defaultZone: 'right',
    mobileSection: 'digest',
    description: 'Nerdy client telemetry: CPU threads, network link RTT/downlink, viewport DPR, and Gateway sync metrics.'
  }
];

export const VALID_WIDGET_IDS = new Set(WIDGET_CATALOG.map((w) => w.id));

export const POPULAR_WEATHER_CITIES = [
  { locationName: 'San Francisco', country: 'United States', latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles' },
  { locationName: 'New York', country: 'United States', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' },
  { locationName: 'London', country: 'United Kingdom', latitude: 51.5072, longitude: -0.1276, timezone: 'Europe/London' },
  { locationName: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin' },
  { locationName: 'Singapore', country: 'Singapore', latitude: 1.3521, longitude: 103.8198, timezone: 'Asia/Singapore' },
  { locationName: 'Tokyo', country: 'Japan', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  { locationName: 'Sydney', country: 'Australia', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' }
];

export const PRESET_TIMEZONES = [
  { label: 'UTC', timeZone: 'UTC' },
  { label: 'San Francisco (PT)', timeZone: 'America/Los_Angeles' },
  { label: 'New York (ET)', timeZone: 'America/New_York' },
  { label: 'London (UK)', timeZone: 'Europe/London' },
  { label: 'Berlin (CET)', timeZone: 'Europe/Berlin' },
  { label: 'Singapore (SGT)', timeZone: 'Asia/Singapore' },
  { label: 'Tokyo (JST)', timeZone: 'Asia/Tokyo' },
  { label: 'Seoul (KST)', timeZone: 'Asia/Seoul' },
  { label: 'Sydney (AEST)', timeZone: 'Australia/Sydney' }
];

/**
 * Map Open-Meteo WMO weather interpretation codes (0..99) to crisp icon + label.
 * @param {number} code
 * @param {boolean} [isDay=true]
 * @returns {{ icon: string, label: string }}
 */
export function describeWmoWeather(code, isDay = true) {
  const c = Number.isFinite(Number(code)) ? Math.round(Number(code)) : 0;
  if (c === 0) return { icon: isDay ? '☀️' : '🌙', label: isDay ? 'Clear sky' : 'Clear night' };
  if (c === 1) return { icon: isDay ? '🌤️' : '🌙', label: 'Mainly clear' };
  if (c === 2) return { icon: '⛅', label: 'Partly cloudy' };
  if (c === 3) return { icon: '☁️', label: 'Overcast' };
  if (c === 45 || c === 48) return { icon: '🌫️', label: 'Misty fog' };
  if (c >= 51 && c <= 57) return { icon: '🌦️', label: 'Light drizzle' };
  if (c >= 61 && c <= 65) return { icon: '🌧️', label: 'Rain' };
  if (c === 66 || c === 67) return { icon: '🌨️', label: 'Freezing rain' };
  if (c >= 71 && c <= 77) return { icon: '❄️', label: 'Snowfall' };
  if (c >= 80 && c <= 82) return { icon: '🌦️', label: 'Rain showers' };
  if (c === 85 || c === 86) return { icon: '🌨️', label: 'Snow showers' };
  if (c >= 95) return { icon: '⛈️', label: 'Thunderstorm' };
  return { icon: '🌤️', label: 'Fair' };
}

/**
 * Convert Celsius temperature to target unit (`celsius` or `fahrenheit`).
 * @param {number} celsius
 * @param {'celsius' | 'fahrenheit'} [unit='celsius']
 * @returns {number}
 */
export function convertTemp(celsius, unit = 'celsius') {
  const val = Number(celsius);
  if (!Number.isFinite(val)) return 0;
  if (unit === 'fahrenheit') {
    return Math.round((val * 9) / 5 + 32);
  }
  return Math.round(val);
}

/**
 * Format a Celsius temperature value with unit symbol (`°C` or `°F`).
 * @param {number} celsius
 * @param {'celsius' | 'fahrenheit'} [unit='celsius']
 * @returns {string}
 */
export function formatTemp(celsius, unit = 'celsius') {
  const rounded = convertTemp(celsius, unit);
  return `${rounded}°${unit === 'fahrenheit' ? 'F' : 'C'}`;
}

/**
 * Build a realistic offline fallback weather snapshot based on latitude & local hour
 * so the Weather widget remains calm and informative offline or inside air-gapped sandboxes.
 * @param {any} weatherSettings
 * @param {Date} [now]
 */
export function buildFallbackWeatherSnapshot(weatherSettings = {}, now = new Date()) {
  const lat = Number.isFinite(Number(weatherSettings?.latitude)) ? Number(weatherSettings.latitude) : 37.7749;
  const absLat = Math.abs(lat);
  const baseMiddayC = absLat < 23.5 ? 31 : (absLat < 40 ? 21 : 14);
  const hour = now.getHours();
  const isDay = hour >= 6 && hour < 18;
  const diurnalOffset = isDay ? 2 : -3;
  const currentTempC = baseMiddayC + diurnalOffset;

  const hourly = [];
  for (let offset = 1; offset <= 6; offset += 1) {
    const slotDate = new Date(now.getTime() + offset * 3600 * 1000);
    const slotHour = slotDate.getHours();
    const slotIsDay = slotHour >= 6 && slotHour < 18;
    const curve = Math.round(Math.sin(((slotHour - 6) / 24) * Math.PI * 2) * 3);
    hourly.push({
      timeLabel: `${String(slotHour).padStart(2, '0')}:00`,
      tempC: baseMiddayC + curve,
      weatherCode: slotIsDay ? 2 : 1,
      isDay: slotIsDay,
      precipProb: absLat < 23.5 && slotHour >= 15 && slotHour <= 19 ? 40 : 15
    });
  }

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daily = [];
  const sampleCodes = [1, 2, 80, 2, 0];
  for (let d = 0; d < 5; d += 1) {
    const dt = new Date(now.getTime() + d * 86400 * 1000);
    const dayLabel = d === 0 ? 'Today' : weekdays[dt.getDay()];
    daily.push({
      date: dt.toISOString().slice(0, 10),
      dayLabel,
      weatherCode: sampleCodes[d % sampleCodes.length],
      maxTempC: baseMiddayC + 3 - (d % 2),
      minTempC: baseMiddayC - 5 + (d % 2),
      precipProb: sampleCodes[d % sampleCodes.length] >= 80 ? 55 : 20,
      uvMax: absLat < 25 ? 8 : 5
    });
  }

  return {
    fetchedAt: now.toISOString(),
    latitude: lat,
    longitude: Number.isFinite(Number(weatherSettings?.longitude)) ? Number(weatherSettings.longitude) : -122.4194,
    isFallback: true,
    current: {
      tempC: currentTempC,
      feelsLikeC: currentTempC + (absLat < 23.5 ? 3 : 0),
      humidity: absLat < 23.5 ? 72 : 58,
      windKmh: 11,
      weatherCode: isDay ? 2 : 1,
      isDay
    },
    hourly,
    daily
  };
}

/**
 * Search cities by name using the zero-key Open-Meteo Geocoding API.
 * @param {string} query
 * @param {typeof globalThis.fetch} [fetchImpl]
 * @returns {Promise<Array<{ locationName: string, country: string, admin1: string, latitude: number, longitude: number, timezone: string }>>}
 */
export async function searchWeatherLocations(query, fetchImpl = globalThis.fetch) {
  const clean = typeof query === 'string' ? query.trim() : '';
  if (clean.length < 2) return [];

  const qLower = clean.toLowerCase();
  const localPresetMatches = POPULAR_WEATHER_CITIES.filter(
    (c) => c.locationName.toLowerCase().includes(qLower) || c.country.toLowerCase().includes(qLower)
  ).map((c) => ({ ...c, admin1: '' }));

  if (typeof fetchImpl !== 'function') {
    return localPresetMatches;
  }

  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', clean);
    url.searchParams.set('count', '5');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');

    const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return localPresetMatches;
    }
    const payload = await res.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const mapped = [];
    for (const r of results) {
      if (!Number.isFinite(Number(r?.latitude)) || !Number.isFinite(Number(r?.longitude))) continue;
      mapped.push({
        locationName: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : clean,
        country: typeof r.country === 'string' ? r.country.trim() : '',
        admin1: typeof r.admin1 === 'string' ? r.admin1.trim() : '',
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        timezone: typeof r.timezone === 'string' && r.timezone ? r.timezone : 'auto'
      });
    }
    return mapped.length > 0 ? mapped : localPresetMatches;
  } catch {
    return localPresetMatches;
  }
}

/**
 * Fetch live weather forecast from Open-Meteo with 30-minute caching & offline fallback.
 * Always keeps internal numbers in Celsius so toggling °C/°F is instant without re-fetching.
 *
 * @param {any} weatherSettings
 * @param {{ force?: boolean, fetchImpl?: typeof globalThis.fetch, now?: Date }} [options]
 */
export async function fetchWeatherForecast(weatherSettings = {}, options = {}) {
  const { force = false, fetchImpl = globalThis.fetch, now = new Date() } = options || {};
  const lat = Number(weatherSettings?.latitude);
  const lon = Number(weatherSettings?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('Invalid weather coordinates');
  }

  const cached = weatherSettings?.cache;
  if (!force && cached && typeof cached === 'object' && !cached.isFallback) {
    const cachedAtMs = Date.parse(cached.fetchedAt || '');
    const sameCoords = Math.abs(Number(cached.latitude) - lat) < 0.02
      && Math.abs(Number(cached.longitude) - lon) < 0.02;
    if (sameCoords && !Number.isNaN(cachedAtMs) && (now.getTime() - cachedAtMs) < WEATHER_CACHE_TTL_MS) {
      return { snapshot: cached, fromCache: true, usedFallback: false };
    }
  }

  if (typeof fetchImpl !== 'function') {
    const fallback = cached || buildFallbackWeatherSnapshot(weatherSettings, now);
    return { snapshot: fallback, fromCache: Boolean(cached), usedFallback: true };
  }

  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lon.toFixed(4));
    url.searchParams.set(
      'current',
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m'
    );
    url.searchParams.set('hourly', 'temperature_2m,weather_code,precipitation_probability');
    url.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max'
    );
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '5');

    const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`Weather HTTP ${res.status}`);
    }
    const data = await res.json();
    const cur = data?.current || {};

    // Extract next 6 upcoming hourly points
    const hourlyTimes = Array.isArray(data?.hourly?.time) ? data.hourly.time : [];
    const hourlyTemps = Array.isArray(data?.hourly?.temperature_2m) ? data.hourly.temperature_2m : [];
    const hourlyCodes = Array.isArray(data?.hourly?.weather_code) ? data.hourly.weather_code : [];
    const hourlyPrecip = Array.isArray(data?.hourly?.precipitation_probability)
      ? data.hourly.precipitation_probability
      : [];

    const currentHourIsoPrefix = now.toISOString().slice(0, 13);
    let startIdx = hourlyTimes.findIndex((t) => typeof t === 'string' && t >= currentHourIsoPrefix);
    if (startIdx < 0) startIdx = 0;

    const hourly = [];
    for (let i = startIdx; i < Math.min(hourlyTimes.length, startIdx + 6); i += 1) {
      const rawTime = String(hourlyTimes[i] || '');
      const hhmm = rawTime.includes('T') ? rawTime.split('T')[1].slice(0, 5) : `${i}:00`;
      const hourNum = Number.parseInt(hhmm.slice(0, 2), 10);
      const isDaySlot = Number.isFinite(hourNum) ? (hourNum >= 6 && hourNum < 18) : true;
      hourly.push({
        timeLabel: hhmm,
        tempC: Number(hourlyTemps[i] ?? cur.temperature_2m ?? 25),
        weatherCode: Number(hourlyCodes[i] ?? cur.weather_code ?? 0),
        isDay: isDaySlot,
        precipProb: Number(hourlyPrecip[i] ?? 0)
      });
    }

    const dailyDates = Array.isArray(data?.daily?.time) ? data.daily.time : [];
    const dailyCodes = Array.isArray(data?.daily?.weather_code) ? data.daily.weather_code : [];
    const dailyMax = Array.isArray(data?.daily?.temperature_2m_max) ? data.daily.temperature_2m_max : [];
    const dailyMin = Array.isArray(data?.daily?.temperature_2m_min) ? data.daily.temperature_2m_min : [];
    const dailyPrecip = Array.isArray(data?.daily?.precipitation_probability_max)
      ? data.daily.precipitation_probability_max
      : [];
    const dailyUv = Array.isArray(data?.daily?.uv_index_max) ? data.daily.uv_index_max : [];

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const daily = [];
    for (let d = 0; d < Math.min(dailyDates.length, 5); d += 1) {
      const dateStr = String(dailyDates[d]);
      const parsedDate = new Date(`${dateStr}T12:00:00`);
      const dayLabel = d === 0
        ? 'Today'
        : (Number.isNaN(parsedDate.getTime()) ? dateStr : weekdays[parsedDate.getDay()]);
      daily.push({
        date: dateStr,
        dayLabel,
        weatherCode: Number(dailyCodes[d] ?? 1),
        maxTempC: Number(dailyMax[d] ?? 28),
        minTempC: Number(dailyMin[d] ?? 22),
        precipProb: Number(dailyPrecip[d] ?? 0),
        uvMax: Number(dailyUv[d] ?? 0)
      });
    }

    const snapshot = {
      fetchedAt: now.toISOString(),
      latitude: lat,
      longitude: lon,
      isFallback: false,
      current: {
        tempC: Number(cur.temperature_2m ?? 26),
        feelsLikeC: Number(cur.apparent_temperature ?? cur.temperature_2m ?? 27),
        humidity: Math.round(Number(cur.relative_humidity_2m ?? 65)),
        windKmh: Math.round(Number(cur.wind_speed_10m ?? 10)),
        weatherCode: Number(cur.weather_code ?? 1),
        isDay: Number(cur.is_day ?? 1) === 1
      },
      hourly,
      daily
    };

    return { snapshot, fromCache: false, usedFallback: false };
  } catch {
    if (cached && typeof cached === 'object') {
      return { snapshot: cached, fromCache: true, usedFallback: true };
    }
    const fallback = buildFallbackWeatherSnapshot(weatherSettings, now);
    return { snapshot: fallback, fromCache: false, usedFallback: true };
  }
}

/**
 * Format a single World Clock entry (`HH:MM`, day indicator, and UTC offset label).
 * @param {string} timeZone
 * @param {Date} [now]
 * @returns {{ time: string, dayMeta: string, valid: boolean }}
 */
export function formatWorldClockEntry(timeZone, now = new Date()) {
  try {
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const metaFmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      timeZoneName: 'shortOffset'
    });
    return {
      time: timeFmt.format(now),
      dayMeta: metaFmt.format(now),
      valid: true
    };
  } catch {
    return {
      time: '--:--',
      dayMeta: 'Invalid TZ',
      valid: false
    };
  }
}
