import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LAYOUT_ZONES,
  SLACK_COLLAPSED_LIMIT,
  WIDGET_ZONES,
  addCustomBackgroundImage,
  addHabitItem,
  addLaunchpadLink,
  addWidgetToLayout,
  addWorldClock,
  createDefaultState,
  getActiveWidgetIds,
  getVisibleSlackDigestSlice,
  importSlackDigest,
  isWidgetActive,
  loadState,
  mergeStates,
  moveWidgetInLayout,
  nudgeWidgetInLayout,
  removeCustomBackgroundImage,
  removeHabitItem,
  removeLaunchpadLink,
  removeWidgetFromLayout,
  removeWorldClock,
  resetDashboardLayout,
  resetMemoryStoreForTests,
  setLayoutEditMode,
  shuffleDailyBackground,
  toggleHabitForDate,
  updateBackgroundSettings,
  updatePomodoroSettings,
  updatePreferences,
  updateScratchpad,
  updateWeatherCache,
  updateWeatherSettings
} from '../js/store.js';

import {
  BACKGROUND_CATEGORIES,
  BACKGROUND_PACK,
  resolveActiveBackground,
  resolveBackgroundTimeMood
} from '../js/backgrounds.js';

import {
  WIDGET_CATALOG,
  convertTemp,
  describeWmoWeather,
  fetchWeatherForecast,
  formatTemp,
  formatWorldClockEntry,
  searchWeatherLocations
} from '../js/widgets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export async function verifyDomHooksAndPrecacheParity() {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sidepanelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const sidepanelJs = fs.readFileSync(path.join(ROOT, 'js/sidepanel.js'), 'utf8');
  const swPwa = fs.readFileSync(path.join(ROOT, 'sw-pwa.js'), 'utf8');

  const extractHtmlIds = (html) => new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
  const extractByIdCalls = (js) => [...new Set([...js.matchAll(/\bbyId\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))];

  const indexIds = extractHtmlIds(indexHtml);
  for (const id of extractByIdCalls(appJs)) {
    assert.ok(indexIds.has(id), `js/app.js references byId('${id}') missing in index.html`);
  }

  const spIds = extractHtmlIds(sidepanelHtml);
  for (const id of extractByIdCalls(sidepanelJs)) {
    assert.ok(spIds.has(id), `js/sidepanel.js references byId('${id}') missing in sidepanel.html`);
  }

  // Every widget in WIDGET_CATALOG must have a matching [data-widget-id], [data-drag-widget], and [data-layout-bar] in index.html
  for (const w of WIDGET_CATALOG) {
    assert.match(indexHtml, new RegExp(`data-widget-id=["']${w.id}["']`), `index.html missing widget section ${w.id}`);
    assert.match(indexHtml, new RegExp(`data-drag-widget=["']${w.id}["']`), `index.html missing drag handle for ${w.id}`);
    assert.match(indexHtml, new RegExp(`data-layout-bar=["']${w.id}["']`), `index.html missing layout bar for ${w.id}`);
  }

  // All 4 drop zones must exist in index.html
  for (const zone of WIDGET_ZONES) {
    assert.ok(indexIds.has(`zone-${zone}`), `index.html missing #zone-${zone}`);
  }

  // All dialogs must declare closedby="any" for modern light-dismiss
  const dialogTags = [...indexHtml.matchAll(/<dialog\b([^>]*)>/gi)];
  assert.ok(dialogTags.length >= 8, 'index.html must include Onboarding, Widget Store, Wallpaper Studio, and core modals');
  for (const [tag, attrs] of dialogTags) {
    assert.match(attrs, /\bclosedby\s*=\s*["']any["']/i, `Dialog missing closedby="any": ${tag}`);
  }

  // Verify sw-pwa.js precaches backgrounds.js & widgets.js
  assert.match(swPwa, /\.\/js\/backgrounds\.js/, 'sw-pwa.js must precache ./js/backgrounds.js');
  assert.match(swPwa, /\.\/js\/widgets\.js/, 'sw-pwa.js must precache ./js/widgets.js');
}

export async function verifyWidgetStoreAndLayoutRearrangement() {
  resetMemoryStoreForTests();
  let state = await loadState();

  // Default layout includes Weather Forecast + core panels
  assert.deepEqual(state.layout.zones, DEFAULT_LAYOUT_ZONES);
  assert.equal(isWidgetActive(state, 'weather'), true, 'Weather Forecast widget must be active by default');
  assert.equal(isWidgetActive(state, 'pomodoro'), false, 'Pomodoro starts available in Widget Store');

  // Add all remaining widgets from WIDGET_CATALOG
  for (const w of WIDGET_CATALOG) {
    if (!isWidgetActive(state, w.id)) {
      state = await addWidgetToLayout(w.id);
    }
  }
  assert.equal(getActiveWidgetIds(state).length, WIDGET_CATALOG.length, 'All 12 widgets must be addable');

  // Remove any widget (including Weather & Core TODOs) and verify underlying data is preserved
  const initialWeatherCity = state.widgets.weather.locationName;
  state = await removeWidgetFromLayout('weather');
  assert.equal(isWidgetActive(state, 'weather'), false);
  assert.ok(state.tombstones['widget:weather'], 'Removed widget records layout tombstone');
  assert.equal(state.widgets.weather.locationName, initialWeatherCity, 'Removing widget must not erase its config');

  state = await removeWidgetFromLayout('todos');
  assert.equal(isWidgetActive(state, 'todos'), false);
  assert.ok(state.todos.length >= 2, 'Removing TODO widget must not delete TODO items');

  // Re-add removed widgets into explicit custom zones
  state = await addWidgetToLayout('weather', 'top');
  assert.ok(state.layout.zones.top.includes('weather'));
  assert.equal(state.tombstones['widget:weather'], undefined, 'Re-adding widget clears its tombstone');

  state = await addWidgetToLayout('todos', 'right');
  assert.ok(state.layout.zones.right.includes('todos'));

  // Reset layout back to canonical defaults
  state = await resetDashboardLayout();
  assert.deepEqual(state.layout.zones, DEFAULT_LAYOUT_ZONES);

  // Rearrange within a column: move 'todos' above 'objectives' in left column
  state = await moveWidgetInLayout('todos', 'left', 0);
  assert.deepEqual(state.layout.zones.left, ['todos', 'objectives']);

  // Rearrange across zones: move 'discovery' to top, 'objectives' to bottom, 'slack' to left
  state = await moveWidgetInLayout('discovery', 'top', 0);
  state = await moveWidgetInLayout('objectives', 'bottom', 0);
  state = await moveWidgetInLayout('slack', 'left', 1);
  assert.deepEqual(state.layout.zones.top, ['discovery']);
  assert.deepEqual(state.layout.zones.left, ['todos', 'slack']);
  assert.deepEqual(state.layout.zones.bottom, ['objectives']);

  // Nudge directional helpers (up/down/left/right)
  state = await nudgeWidgetInLayout('slack', 'up'); // moves slack to index 0 of left
  assert.deepEqual(state.layout.zones.left, ['slack', 'todos']);
  state = await nudgeWidgetInLayout('slack', 'right'); // moves slack from left to right
  assert.ok(state.layout.zones.right.includes('slack'));
  assert.ok(!state.layout.zones.left.includes('slack'));

  // Layout edit mode toggle
  state = await setLayoutEditMode(true);
  assert.equal(state.layout.editMode, true);
  state = await setLayoutEditMode(false);
  assert.equal(state.layout.editMode, false);

  // Gist merge preserves newer layout customization
  const older = createDefaultState(new Date('2026-11-19T08:00:00Z'));
  const merged = mergeStates(older, state);
  assert.deepEqual(merged.layout.zones, state.layout.zones, 'mergeStates must adopt newer widget layout');
}

export async function verifySlackFeedCollapseDefault10() {
  resetMemoryStoreForTests();
  let state = await loadState();

  assert.equal(SLACK_COLLAPSED_LIMIT, 5, 'Slack feed default collapsed limit must be 5');
  assert.equal(state.wellness.slackExpanded, false, 'Slack feed must default to collapsed (5 items)');
  assert.equal(state.wellness.slackPanelCollapsed, false, 'Slack card body starts open showing 5 items');

  // Populate 16 Daily Digest items
  const sixteenItems = Array.from({ length: 16 }, (_, idx) => ({
    id: `slack_bulk_${idx + 1}`,
    channel: idx % 2 === 0 ? '#frontend' : '#platform-eng',
    badge: idx < 3 ? 'P0' : 'P1',
    headline: `Digest Thread #${idx + 1}`,
    summary: `Detailed context for item ${idx + 1}`,
    url: `https://slack.com/archives/C001/p1000${idx}`
  }));

  state = await importSlackDigest({
    date: '2026-11-20',
    deliveredAt: '09:00 UTC',
    items: sixteenItems
  });
  assert.ok(state.slackDigest.items.length >= 16);
  const totalCount = state.slackDigest.items.length;

  // 1. Default collapsed to 5 items
  const defaultSlice = getVisibleSlackDigestSlice(state.slackDigest.items, state.wellness);
  assert.equal(defaultSlice.visibleItems.length, 5, 'Default Slack view must show at most 5 items');
  assert.equal(defaultSlice.totalCount, totalCount);
  assert.equal(defaultSlice.hiddenCount, totalCount - 5);
  assert.equal(defaultSlice.hasOverflow, true);
  assert.equal(defaultSlice.isExpanded, false);

  // 2. Expand to show all items
  state = await updatePreferences({ slackExpanded: true });
  const expandedSlice = getVisibleSlackDigestSlice(state.slackDigest.items, state.wellness);
  assert.equal(expandedSlice.visibleItems.length, totalCount, 'Expanded Slack view must show all items');
  assert.equal(expandedSlice.hiddenCount, 0);
  assert.equal(expandedSlice.isExpanded, true);

  // 3. Collapse back to 5 items
  state = await updatePreferences({ slackExpanded: false });
  const recollapsedSlice = getVisibleSlackDigestSlice(state.slackDigest.items, state.wellness);
  assert.equal(recollapsedSlice.visibleItems.length, 5);

  // 4. Full panel collapse (0 items rendered while collapsed)
  state = await updatePreferences({ slackPanelCollapsed: true });
  const panelCollapsedSlice = getVisibleSlackDigestSlice(state.slackDigest.items, state.wellness);
  assert.equal(panelCollapsedSlice.isPanelCollapsed, true);
  assert.equal(panelCollapsedSlice.visibleItems.length, 0);
}

export async function verifyWeatherAndUtilityWidgets() {
  resetMemoryStoreForTests();
  await loadState();

  // Unit conversions & WMO descriptions
  assert.equal(convertTemp(0, 'fahrenheit'), 32);
  assert.equal(convertTemp(25, 'fahrenheit'), 77);
  assert.equal(formatTemp(28.2, 'celsius'), '28°C');
  assert.equal(formatTemp(25, 'fahrenheit'), '77°F');
  assert.equal(describeWmoWeather(0, true).icon, '☀️');
  assert.equal(describeWmoWeather(0, false).icon, '🌙');
  assert.equal(describeWmoWeather(95, true).label, 'Thunderstorm');

  // Invalid coordinates rejected
  await assert.rejects(
    async () => fetchWeatherForecast({ latitude: 145, longitude: 0 }),
    /Invalid weather coordinates/i
  );

  // Mock Open-Meteo Forecast API + 30-min cache behavior
  let fetchCalls = 0;
  const mockNow = new Date('2026-11-20T09:00:00Z');
  const mockWeatherFetch = async (url) => {
    fetchCalls += 1;
    assert.match(String(url), /api\.open-meteo\.com\/v1\/forecast/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        current: {
          temperature_2m: 29.4,
          apparent_temperature: 32.1,
          relative_humidity_2m: 74,
          wind_speed_10m: 12.6,
          weather_code: 2,
          is_day: 1
        },
        hourly: {
          time: [
            '2026-11-20T09:00', '2026-11-20T10:00', '2026-11-20T11:00',
            '2026-11-20T12:00', '2026-11-20T13:00', '2026-11-20T14:00'
          ],
          temperature_2m: [29, 30, 31, 32, 31, 30],
          weather_code: [2, 2, 1, 1, 80, 80],
          precipitation_probability: [10, 15, 20, 25, 60, 55]
        },
        daily: {
          time: ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'],
          weather_code: [2, 80, 1, 0, 2],
          temperature_2m_max: [32, 31, 33, 33, 32],
          temperature_2m_min: [24, 24, 25, 24, 23],
          precipitation_probability_max: [45, 70, 20, 10, 30],
          uv_index_max: [8.4, 7.1, 9.0, 9.2, 8.0]
        }
      })
    };
  };

  let st = await updateWeatherSettings({
    locationName: 'San Francisco',
    latitude: 37.7749,
    longitude: -122.4194,
    unit: 'celsius'
  });

  const liveRes = await fetchWeatherForecast(st.widgets.weather, { fetchImpl: mockWeatherFetch, now: mockNow });
  assert.equal(liveRes.usedFallback, false);
  assert.equal(liveRes.fromCache, false);
  assert.equal(Math.round(liveRes.snapshot.current.tempC), 29);
  assert.equal(liveRes.snapshot.hourly.length, 6);
  assert.equal(liveRes.snapshot.daily.length, 5);

  st = await updateWeatherCache(liveRes.snapshot);
  const cachedRes = await fetchWeatherForecast(st.widgets.weather, {
    fetchImpl: mockWeatherFetch,
    now: new Date('2026-11-20T09:10:00Z')
  });
  assert.equal(cachedRes.fromCache, true, 'Within 30m TTL, weather must be served from cache');
  assert.equal(fetchCalls, 1, 'Cache hit must not make extra network call');

  // Offline fallback resilience
  const offlineRes = await fetchWeatherForecast(
    { locationName: 'Tokyo', latitude: 35.6762, longitude: 139.6503, cache: null },
    { force: true, fetchImpl: async () => { throw new Error('Network down'); }, now: mockNow }
  );
  assert.equal(offlineRes.usedFallback, true);
  assert.equal(offlineRes.snapshot.daily.length, 5);

  // Geocoding search + offline preset fallback
  const geoMatches = await searchWeatherLocations('Kyoto', async () => ({
    ok: true,
    json: async () => ({
      results: [{ name: 'Kyoto', country: 'Japan', admin1: 'Kyoto', latitude: 35.0116, longitude: 135.7681, timezone: 'Asia/Tokyo' }]
    })
  }));
  assert.equal(geoMatches[0].locationName, 'Kyoto');

  const offlineCityMatches = await searchWeatherLocations('Tokyo', async () => { throw new Error('Offline'); });
  assert.equal(offlineCityMatches[0].locationName, 'Tokyo');

  // Utility Widgets CRUD: World Clock, Scratchpad, Launchpad, Habits, Pomodoro
  const clk = await addWorldClock({ label: 'Berlin', timeZone: 'Europe/Berlin' });
  assert.equal(formatWorldClockEntry(clk.timeZone, mockNow).valid, true);
  await assert.rejects(async () => addWorldClock({ label: 'Bad', timeZone: 'Invalid/Zone_X' }));
  st = await removeWorldClock(clk.id);
  assert.ok(st.tombstones[clk.id]);

  st = await updateScratchpad('Check p95 edge latency after rollout');
  assert.match(st.widgets.scratchpad.text, /p95 edge latency/);

  const lp = await addLaunchpadLink({ label: 'Grafana', url: 'https://grafana.com', icon: '📊' });
  assert.equal(lp.icon, '📊');
  await assert.rejects(async () => addLaunchpadLink({ label: 'XSS', url: 'javascript:alert(1)' }));
  st = await removeLaunchpadLink(lp.id);
  assert.ok(st.tombstones[lp.id]);

  const hb = await addHabitItem('Read 1 architecture RFC');
  st = await toggleHabitForDate(hb.id, '2026-11-20');
  assert.ok(st.widgets.habits.items.find((h) => h.id === hb.id).completedDates.includes('2026-11-20'));
  st = await removeHabitItem(hb.id);
  assert.ok(st.tombstones[hb.id]);

  st = await updatePomodoroSettings({ workMins: 50, completedSessions: 3 });
  assert.equal(st.widgets.pomodoro.workMins, 50);
  assert.equal(st.widgets.pomodoro.completedSessions, 3);
}

export async function verifyCircadianNerdyBackgrounds() {
  resetMemoryStoreForTests();
  let st = await loadState();

  // Catalog coverage across nerdy categories (pixel, technology, modern, retro, space)
  assert.ok(BACKGROUND_PACK.length >= 12, 'BACKGROUND_PACK must provide >= 12 nerdy scenes');
  for (const cat of BACKGROUND_CATEGORIES) {
    assert.ok(BACKGROUND_PACK.some((s) => s.category === cat.id), `Missing scene in category ${cat.id}`);
  }

  // Time-of-day mood transitions
  assert.equal(resolveBackgroundTimeMood(new Date('2026-11-20T07:30:00')), 'morning');
  assert.equal(resolveBackgroundTimeMood(new Date('2026-11-20T13:15:00')), 'deep-work');
  assert.equal(resolveBackgroundTimeMood(new Date('2026-11-20T19:00:00')), 'evening');
  assert.equal(resolveBackgroundTimeMood(new Date('2026-11-20T23:30:00')), 'night');
  assert.equal(resolveBackgroundTimeMood(new Date('2026-11-20T08:00:00'), 'night'), 'night');

  // Same-day determinism & multi-day random switching
  const morningNov20 = resolveActiveBackground(st.background, new Date('2026-11-20T08:00:00'));
  const eveningNov20 = resolveActiveBackground(st.background, new Date('2026-11-20T19:30:00'));
  assert.equal(
    morningNov20.item.id,
    eveningNov20.item.id,
    'Same calendar day should keep the same daily scene while adapting its mood & palette'
  );
  assert.notEqual(
    morningNov20.imageUri,
    eveningNov20.imageUri,
    'Time-of-day shift from morning to evening must change the rendered circadian scene lighting/colors'
  );

  const distinctAcrossTwoWeeks = new Set();
  for (let day = 1; day <= 14; day += 1) {
    const dt = new Date(`2026-11-${String(day).padStart(2, '0')}T10:00:00`);
    const picked = resolveActiveBackground(st.background, dt);
    distinctAcrossTwoWeeks.add(picked.item.id);
  }
  assert.ok(distinctAcrossTwoWeeks.size >= 4, 'Daily random mode must switch wallpapers across days');

  // Category filter strictly restricts daily random pool (e.g. Pixel Art only)
  st = await updateBackgroundSettings({ categories: ['pixel'], mode: 'daily-random' });
  for (let day = 1; day <= 20; day += 1) {
    const dt = new Date(`2026-12-${String(day).padStart(2, '0')}T11:00:00`);
    const picked = resolveActiveBackground(st.background, dt);
    assert.equal(picked.item.category, 'pixel', 'Pixel-only filter must pick pixel scenes exclusively');
    assert.equal(picked.isPixelArt, true);
    assert.match(picked.svgMarkup, /crispEdges/, 'Pixel scenes must render with crispEdges');
  }

  // Shuffle nonce updates selection
  const seenShuffles = new Set();
  for (let i = 0; i < 6; i += 1) {
    st = await shuffleDailyBackground();
    const res = resolveActiveBackground(st.background, new Date('2026-11-20T10:00:00'));
    seenShuffles.add(res.item.id);
  }
  assert.ok(seenShuffles.size >= 2, 'shuffleDailyBackground must roll new scenes on demand');

  // Custom HTTPS wallpaper URLs & XSS rejection
  await assert.rejects(
    async () => addCustomBackgroundImage({ name: 'Evil', url: 'javascript:alert(1)' }),
    /valid http/i
  );
  const custom = await addCustomBackgroundImage({
    name: 'Pixel Cyber Deck',
    url: 'https://images.example.com/pixel-deck.png',
    isPixelArt: true
  });
  st = await updateBackgroundSettings({ mode: 'pinned', pinnedId: custom.id, opacity: 0.55, blurPx: 3 });
  const pinnedCustom = resolveActiveBackground(st.background, new Date('2026-11-20T20:00:00'));
  assert.equal(pinnedCustom.isCustomUrl, true);
  assert.equal(pinnedCustom.imageUri, 'https://images.example.com/pixel-deck.png');
  assert.equal(pinnedCustom.opacity, 0.55);
  assert.equal(pinnedCustom.blurPx, 3);

  st = await removeCustomBackgroundImage(custom.id);
  assert.ok(st.tombstones[custom.id]);

  // Off mode
  st = await updateBackgroundSettings({ mode: 'off' });
  const offRes = resolveActiveBackground(st.background, new Date('2026-11-20T10:00:00'));
  assert.equal(offRes.enabled, false);
  assert.equal(offRes.imageUri, '');
}

export async function runAllV2FeatureTests() {
  await verifyDomHooksAndPrecacheParity();
  await verifyWidgetStoreAndLayoutRearrangement();
  await verifySlackFeedCollapseDefault10();
  await verifyWeatherAndUtilityWidgets();
  await verifyCircadianNerdyBackgrounds();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runAllV2FeatureTests();
  console.log('PASS: All v2 Feature Verification Suites (Widget Store, Weather, Layout Rearrangement, Slack 10-item Collapse, Circadian Nerdy Wallpapers) succeeded.');
}
