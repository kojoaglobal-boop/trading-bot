export function buildTradeFrequencyGuard({
  state = {},
  now = new Date(),
  maxDailyEntries = 0,
  maxEntriesPerHour = 0,
  minMinutesBetweenEntries = 0
} = {}) {
  const entries = normalizeEntries(state.submittedEntries);
  const nowTime = new Date(now).getTime();
  const hourStart = nowTime - 60 * 60 * 1000;
  const recentHourEntries = entries.filter((entry) => Date.parse(entry.submittedAt) >= hourStart);
  const latestEntry = entries
    .filter((entry) => Number.isFinite(Date.parse(entry.submittedAt)))
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))[0];

  const dailyLimit = Number(maxDailyEntries || 0);
  if (dailyLimit > 0 && entries.length >= dailyLimit) {
    return block("MAX_DAILY_ENTRIES", `daily entry cap reached (${entries.length}/${dailyLimit})`, {
      entriesToday: entries.length,
      entriesLastHour: recentHourEntries.length
    });
  }

  const hourlyLimit = Number(maxEntriesPerHour || 0);
  if (hourlyLimit > 0 && recentHourEntries.length >= hourlyLimit) {
    return block("MAX_HOURLY_ENTRIES", `hourly entry cap reached (${recentHourEntries.length}/${hourlyLimit})`, {
      entriesToday: entries.length,
      entriesLastHour: recentHourEntries.length
    });
  }

  const minGap = Number(minMinutesBetweenEntries || 0);
  if (minGap > 0 && latestEntry) {
    const minutesSinceLastEntry = (nowTime - Date.parse(latestEntry.submittedAt)) / 60000;
    if (minutesSinceLastEntry >= 0 && minutesSinceLastEntry < minGap) {
      return block("ENTRY_COOLDOWN", `entry cooldown active (${minutesSinceLastEntry.toFixed(1)}m/${minGap}m)`, {
        entriesToday: entries.length,
        entriesLastHour: recentHourEntries.length,
        minutesSinceLastEntry
      });
    }
  }

  return {
    status: "ACTIVE",
    blocksEntries: false,
    reason: "Trade frequency guard is inside limits.",
    entriesToday: entries.length,
    entriesLastHour: recentHourEntries.length,
    minutesSinceLastEntry: latestEntry ? (nowTime - Date.parse(latestEntry.submittedAt)) / 60000 : null
  };
}

export function appendSubmittedEntry(state, entry, { limit = 300 } = {}) {
  return {
    ...state,
    submittedEntries: [
      ...normalizeEntries(state.submittedEntries),
      {
        submittedAt: entry.submittedAt,
        barTime: entry.barTime || entry.latestBarTime || null,
        dedupeKey: entry.dedupeKey || null,
        epic: entry.epic || null,
        direction: entry.direction || null,
        resolution: entry.resolution || null,
        setupType: entry.setupType || null
      }
    ].slice(-limit)
  };
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.filter((entry) => entry?.submittedAt && Number.isFinite(Date.parse(entry.submittedAt)));
}

function block(status, reason, extra = {}) {
  return {
    status,
    blocksEntries: true,
    reason,
    ...extra
  };
}
