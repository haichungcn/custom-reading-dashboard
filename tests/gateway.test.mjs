import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LAYOUT_ZONES,
  SLACK_COLLAPSED_LIMIT,
  addCustomBackgroundImage,
  addHabitItem,
  addLaunchpadLink,
  addWidgetToLayout,
  addWorldClock,
  applyRssPresetPack,
  applyStarterPreset,
  detectLocalTimeZone,
  exportRssSourcesOpml,
  getActiveWidgetIds,
  getVisibleSlackDigestSlice,
  importRssSourcesOpml,
  importSlackDigest,
  isWidgetActive,
  loadState,
  moveWidgetInLayout,
  nudgeWidgetInLayout,
  parseRssSourcesOpmlOrJson,
  removeWidgetFromLayout,
  resetDashboardLayout,
  resetMemoryStoreForTests,
  shuffleDailyBackground,
  syncFromLocalBundle,
  toggleHabitForDate,
  updateBackgroundSettings,
  updateDigestConfig,
  updatePreferences,
  updateScratchpad,
  updateWeatherSettings
} from '../js/store.js';

import { getGreetingData } from '../js/wellness.js';

import {
  BACKGROUND_PACK,
  resolveActiveBackground,
  resolveBackgroundTimeMood
} from '../js/backgrounds.js';

import {
  WIDGET_CATALOG,
  convertTemp,
  describeWmoWeather,
  fetchWeatherForecast,
  searchWeatherLocations
} from '../js/widgets.js';

import {
  verifyDomHooksAndPrecacheParity,
  verifyWidgetStoreAndLayoutRearrangement,
  verifySlackFeedCollapseDefault10,
  verifyWeatherAndUtilityWidgets,
  verifyCircadianNerdyBackgrounds
} from './verify_v2_features.mjs';

describe('Calm Morning Gateway v2 — Complete Feature Suite', () => {
  it('verifies MV3 DOM hooks, drag handles, dialogs closedby="any", and PWA precache parity', async () => {
    await verifyDomHooksAndPrecacheParity();
  });

  it('supports adding, removing, and rearranging all 12 components across Top, Left, Right, and Bottom zones', async () => {
    await verifyWidgetStoreAndLayoutRearrangement();

    resetMemoryStoreForTests();
    await loadState();
    // Boundary nudges: moving top item of left column UP pushes it to full-width Top Deck
    let st = await nudgeWidgetInLayout('objectives', 'up');
    assert.ok(st.layout.zones.top.includes('objectives'));
    // Moving down from Top Deck returns to top of Left Column
    st = await nudgeWidgetInLayout('objectives', 'down');
    assert.equal(st.layout.zones.left[0], 'objectives');
    // Moving last item of Right Column DOWN pushes it to Full-Width Bottom Deck
    const lastRight = st.layout.zones.right[st.layout.zones.right.length - 1];
    st = await nudgeWidgetInLayout(lastRight, 'down');
    assert.equal(st.layout.zones.bottom[0], lastRight);

    st = await resetDashboardLayout();
    assert.deepEqual(st.layout.zones, DEFAULT_LAYOUT_ZONES);
    assert.equal(getActiveWidgetIds(st).length, 6);
  });

  it('collapses the Slack Digest feed to 5 items by default and expands/collapses cleanly', async () => {
    await verifySlackFeedCollapseDefault10();

    resetMemoryStoreForTests();
    await loadState();
    // Under-5 items edge case: hasOverflow must be false when <= 5 items
    const fourItems = Array.from({ length: 4 }, (_, i) => ({
      id: `s4_${i}`,
      channel: '#engineering',
      headline: `Short digest #${i + 1}`,
      summary: 'Concise note'
    }));
    const slice4 = getVisibleSlackDigestSlice(fourItems, { slackExpanded: false, slackPanelCollapsed: false });
    assert.equal(slice4.visibleItems.length, 4);
    assert.equal(slice4.hasOverflow, false);
    assert.equal(slice4.hiddenCount, 0);
    assert.equal(SLACK_COLLAPSED_LIMIT, 5);
  });

  it('fetches, caches, converts (°C/°F), and falls back gracefully for Weather Forecast + utility widgets', async () => {
    await verifyWeatherAndUtilityWidgets();

    assert.equal(WIDGET_CATALOG.length, 12);
    assert.equal(convertTemp(100, 'fahrenheit'), 212);
    assert.equal(describeWmoWeather(63, true).label, 'Rain');

    resetMemoryStoreForTests();
    await loadState();
    await addWidgetToLayout('scratchpad', 'left');
    await addWidgetToLayout('habit-tracker', 'left');
    await addWidgetToLayout('world-clock', 'right');
    await addWidgetToLayout('launchpad', 'top');
    const st = await loadState();
    for (const id of ['scratchpad', 'habit-tracker', 'world-clock', 'launchpad']) {
      assert.equal(isWidgetActive(st, id), true);
    }
  });

  it('switches nerdy wallpapers daily, adapts to time-of-day mood, and configures pixel/tech/modern/custom options', async () => {
    await verifyCircadianNerdyBackgrounds();

    resetMemoryStoreForTests();
    const st = await loadState();
    const moods = ['morning', 'deep-work', 'evening', 'night'];
    const uris = new Set();
    const sampleTimes = [
      new Date('2026-11-20T08:00:00'),
      new Date('2026-11-20T14:00:00'),
      new Date('2026-11-20T18:30:00'),
      new Date('2026-11-20T23:00:00')
    ];
    sampleTimes.forEach((t, idx) => {
      assert.equal(resolveBackgroundTimeMood(t), moods[idx]);
      const bg = resolveActiveBackground(st.background, t);
      assert.equal(bg.timeMood, moods[idx]);
      uris.add(bg.imageUri);
    });
    assert.equal(uris.size, 4, 'Each time-of-day phase must render a distinct circadian mood palette');
    assert.equal(BACKGROUND_PACK.filter((b) => b.isPixelArt).length, 4);
  });

  it('provides neutral defaults, onboarding preset switching, OPML portability, and custom Digest URL sync', async () => {
    resetMemoryStoreForTests();
    let st = await loadState();
    assert.equal(st.userName, '');
    assert.equal(st.onboardingCompleted, false);
    assert.equal(st.widgets.worldClock.clocks[0].timeZone, detectLocalTimeZone());
    assert.equal(getGreetingData(new Date('2026-11-20T08:00:00'), st.userName).greeting, 'Good morning');
    assert.equal(getGreetingData(new Date('2026-11-20T08:00:00'), 'Sam').greeting, 'Good morning, Sam');

    st = await applyStarterPreset('minimal', {
      userName: 'Sam',
      includeDigestWidget: false,
      markOnboardingComplete: true
    });
    assert.equal(st.onboardingCompleted, true);
    assert.equal(st.objectives.length, 0);
    assert.equal(st.rssSources.length, 0);
    assert.equal(isWidgetActive(st, 'slack'), false);

    st = await applyStarterPreset('ai-web', { includeDigestWidget: true });
    assert.ok(st.objectives.length >= 2);
    assert.ok(st.rssSources.length >= 10);
    assert.equal(isWidgetActive(st, 'slack'), true);

    const opmlXml = exportRssSourcesOpml(st.rssSources);
    const parsedFeeds = parseRssSourcesOpmlOrJson(opmlXml);
    assert.equal(parsedFeeds.length, st.rssSources.length);

    await applyRssPresetPack('minimal');
    const imported = await importRssSourcesOpml(opmlXml, { mode: 'replace' });
    assert.equal(imported.importedCount, parsedFeeds.length);

    await updateDigestConfig({ title: 'Team Pulse', feedUrl: 'https://digest.example.com/today.json' });
    const syncRes = await syncFromLocalBundle(async () => ({
      ok: true,
      json: async () => ({
        date: '2026-11-20',
        deliveredAt: '09:00 UTC',
        items: [{ channel: '#core', headline: 'Release green', summary: 'All checks passed' }]
      })
    }));
    assert.equal(syncRes.synced, true);
    assert.equal(syncRes.state.digestConfig.title, 'Team Pulse');
    assert.equal(syncRes.state.slackDigest.items[0].headline, 'Release green');
  });
});
