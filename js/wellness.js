/**
 * Custom Reading Dashboard — Circadian Mood & Mindful Wellness Engine (`js/wellness.js`)
 *
 * Computes temporal circadian themes, anti-overwork wind-down cues (17:30+),
 * gentle stretch/hydration/20-20-20 rotation prompts, and 4-4-6 breathing phases.
 */

import { loadState, updatePreferences } from './store.js';

export const WELLNESS_PROMPTS = [
  {
    id: 'stretch_chest',
    icon: '🌿',
    title: 'Mindful Stretch',
    instruction: 'Stand up for a 60-second chest opener and gentle shoulder roll away from the desk.'
  },
  {
    id: 'eye_rest_202020',
    icon: '👀',
    title: '20-20-20 Eye Rest',
    instruction: 'Look at something 20 feet away for 20 seconds and let your focus soften.'
  },
  {
    id: 'hydration_check',
    icon: '💧',
    title: 'Hydration Check',
    instruction: 'Take a slow sip of water and check if your water bottle needs a refill.'
  },
  {
    id: 'posture_reset',
    icon: '🪑',
    title: 'Posture Reset',
    instruction: 'Unclench your jaw, drop your shoulders away from your ears, and lengthen your spine.'
  },
  {
    id: 'wrist_neck_release',
    icon: '🙌',
    title: 'Wrist & Neck Release',
    instruction: 'Shake out your hands gently and tilt each ear slowly toward your shoulder.'
  },
  {
    id: 'micro_sunlight',
    icon: '🌤️',
    title: 'Micro Reset',
    instruction: 'Step toward a window for natural daylight and take three unhurried breaths.'
  }
];

export const CALM_QUOTES = [
  'Clarity over volume. Finish three meaningful things rather than chasing twenty.',
  'Sustainable engineering pace beats heroic late-night sprints every week.',
  'Protect deep work blocks like production availability.',
  'Strong architecture removes cognitive load so the team can think calmly.',
  'Closing the laptop on time is part of operational excellence.',
  'Pause before reacting: most urgency is noise until verified.'
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const BREATH_INHALE_MS = 4000;
const BREATH_HOLD_MS = 4000;
const BREATH_EXHALE_MS = 6000;
const BREATH_CYCLE_MS = BREATH_INHALE_MS + BREATH_HOLD_MS + BREATH_EXHALE_MS; // 14s

/**
 * Coerce a Date-like value to a valid Date instance.
 * @param {Date} [now]
 * @returns {Date}
 */
function toValidDate(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) {
    return now;
  }
  return new Date();
}

/**
 * Compute ISO-8601 week number (1..53) for the local calendar date.
 * @param {Date} date
 * @returns {number}
 */
function getIsoWeekNumber(date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Compute circadian mood from local clock time or explicit override.
 * - 06:00 - 09:59 -> 'morning'
 * - 10:00 - 17:29 -> 'deep-work'
 * - 17:30 - 05:59 -> 'evening'
 * @param {Date} [now]
 * @param {'auto' | 'morning' | 'deep-work' | 'evening'} [moodOverride='auto']
 * @returns {'morning' | 'deep-work' | 'evening'}
 */
export function computeCircadianMood(now = new Date(), moodOverride = 'auto') {
  if (moodOverride === 'morning' || moodOverride === 'deep-work' || moodOverride === 'evening') {
    return moodOverride;
  }
  const validNow = toValidDate(now);
  const minutes = validNow.getHours() * 60 + validNow.getMinutes();

  if (minutes >= 360 && minutes < 600) {
    return 'morning';
  }
  if (minutes >= 600 && minutes < 1050) {
    return 'deep-work';
  }
  return 'evening';
}

/**
 * Compute greeting copy, ISO week label, mood, and evening wind-down flag.
 * @param {Date} [now]
 * @param {string} [userName='']
 * @returns {{ greeting: string, dateLabel: string, mood: 'morning' | 'deep-work' | 'evening', moodLabel: string, isEveningWindDown: boolean }}
 */
export function getGreetingData(now = new Date(), userName = '') {
  const validNow = toValidDate(now);
  const cleanName = typeof userName === 'string' ? userName.trim() : '';
  const minutes = validNow.getHours() * 60 + validNow.getMinutes();

  let baseGreeting;
  if (minutes >= 360 && minutes < 720) {
    baseGreeting = 'Good morning';
  } else if (minutes >= 720 && minutes < 1050) {
    baseGreeting = 'Good afternoon';
  } else {
    baseGreeting = 'Good evening';
  }
  const greeting = cleanName ? `${baseGreeting}, ${cleanName}` : baseGreeting;

  const mood = computeCircadianMood(validNow, 'auto');
  let moodLabel = '🧘 Deep Work Flow';
  if (mood === 'morning') {
    moodLabel = '🌅 Morning Warmth';
  } else if (mood === 'evening') {
    moodLabel = '🍵 Evening Wind-Down';
  }

  const weekday = WEEKDAYS[validNow.getDay()];
  const month = MONTHS[validNow.getMonth()];
  const day = validNow.getDate();
  const weekNum = getIsoWeekNumber(validNow);
  const dateLabel = `${weekday}, ${month} ${day} · Week ${weekNum}`;

  return {
    greeting,
    dateLabel,
    mood,
    moodLabel,
    isEveningWindDown: mood === 'evening'
  };
}

/**
 * Select active wellness prompt and escalate gently for >=60m continuous focus or 17:30+ wind-down.
 * @param {any} wellnessState
 * @param {Date} [now]
 * @returns {{ id: string, icon: string, title: string, instruction: string, activeMinutes: number, isOverworkWarning: boolean }}
 */
export function getActiveWellnessPrompt(wellnessState, now = new Date()) {
  const validNow = toValidDate(now);
  const startMs = typeof wellnessState?.activeMinutesStart === 'string'
    ? Date.parse(wellnessState.activeMinutesStart)
    : Number.NaN;
  const activeMinutes = !Number.isNaN(startMs)
    ? Math.max(0, Math.floor((validNow.getTime() - startMs) / 60000))
    : 0;

  const clockMood = computeCircadianMood(validNow, 'auto');
  const isEvening = clockMood === 'evening' || wellnessState?.moodOverride === 'evening';

  if (isEvening) {
    return {
      id: 'evening_wind_down',
      icon: '🍵',
      title: 'Evening Wind-Down',
      instruction: 'After 17:30 — step away from work, take a light walk or stretch, and roll over unfinished tasks with zero guilt.',
      activeMinutes,
      isOverworkWarning: true
    };
  }

  const rawIndex = Number.isFinite(wellnessState?.promptIndex) && wellnessState.promptIndex >= 0
    ? Math.floor(wellnessState.promptIndex)
    : 0;
  const prompt = WELLNESS_PROMPTS[rawIndex % WELLNESS_PROMPTS.length];

  if (activeMinutes >= 60) {
    return {
      id: prompt.id,
      icon: prompt.icon,
      title: `${prompt.title} (${activeMinutes}m active)`,
      instruction: `${prompt.instruction} You have been focused for ${activeMinutes}m — take a 60s break.`,
      activeMinutes,
      isOverworkWarning: true
    };
  }

  return {
    id: prompt.id,
    icon: prompt.icon,
    title: prompt.title,
    instruction: prompt.instruction,
    activeMinutes,
    isOverworkWarning: false
  };
}

/**
 * Record a completed mindful break, advance prompt rotation, and reset active stretch timer.
 * @param {Date} [now]
 * @returns {Promise<any>}
 */
export async function recordBreakTaken(now = new Date()) {
  const validNow = toValidDate(now);
  const nowIso = validNow.toISOString();
  const state = await loadState();

  const currentBreaks = Number.isFinite(state.wellness?.breaksToday) ? state.wellness.breaksToday : 0;
  const currentIdx = Number.isFinite(state.wellness?.promptIndex) ? state.wellness.promptIndex : 0;

  return await updatePreferences({
    breaksToday: currentBreaks + 1,
    lastBreakAt: nowIso,
    promptIndex: (currentIdx + 1) % WELLNESS_PROMPTS.length,
    activeMinutesStart: nowIso
  });
}

/**
 * Compute current 4-4-6 Mindful Breathing phase at `elapsedMs` (14s cycle, 60s default total).
 * @param {number} elapsedMs
 * @param {number} [totalDurationMs=60000]
 * @returns {{ done: boolean, phase: 'inhale' | 'hold' | 'exhale' | 'complete', label: string, secondsRemainingInPhase: number, progressRatio: number }}
 */
export function getBreathingPhaseAtElapsedMs(elapsedMs, totalDurationMs = 60000) {
  const total = Number.isFinite(totalDurationMs) && totalDurationMs > 0 ? totalDurationMs : 60000;
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const progressRatio = Math.min(1, elapsed / total);

  if (elapsed >= total) {
    return {
      done: true,
      phase: 'complete',
      label: 'Session Complete — Notice the Calm',
      secondsRemainingInPhase: 0,
      progressRatio: 1
    };
  }

  const cyclePos = elapsed % BREATH_CYCLE_MS;
  const remainingTotal = total - elapsed;

  if (cyclePos < BREATH_INHALE_MS) {
    const remaining = Math.min(BREATH_INHALE_MS - cyclePos, remainingTotal);
    return {
      done: false,
      phase: 'inhale',
      label: 'Inhale slowly through your nose',
      secondsRemainingInPhase: Math.max(1, Math.ceil(remaining / 1000)),
      progressRatio
    };
  }

  if (cyclePos < BREATH_INHALE_MS + BREATH_HOLD_MS) {
    const remaining = Math.min(BREATH_INHALE_MS + BREATH_HOLD_MS - cyclePos, remainingTotal);
    return {
      done: false,
      phase: 'hold',
      label: 'Hold gently',
      secondsRemainingInPhase: Math.max(1, Math.ceil(remaining / 1000)),
      progressRatio
    };
  }

  const remaining = Math.min(BREATH_CYCLE_MS - cyclePos, remainingTotal);
  return {
    done: false,
    phase: 'exhale',
    label: 'Exhale softly & drop your shoulders',
    secondsRemainingInPhase: Math.max(1, Math.ceil(remaining / 1000)),
    progressRatio
  };
}
