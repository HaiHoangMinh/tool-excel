export type TeamConfig = {
  whatsapp_group: string
  message_text: string
  send: boolean
}

export type SettingsCache = {
  version: number
  last_file_name: string
  updated_at: string
  teams: Record<string, TeamConfig>
}

const STORAGE_KEY = 'tool-excel-web-settings'

function defaultCache(): SettingsCache {
  return {
    version: 1,
    last_file_name: '',
    updated_at: '',
    teams: {},
  }
}

export function loadCache(): SettingsCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultCache()
    const data = JSON.parse(raw) as SettingsCache
    if (!data.teams || typeof data.teams !== 'object') return defaultCache()
    return { ...defaultCache(), ...data, teams: data.teams }
  } catch {
    return defaultCache()
  }
}

export function saveCache(data: SettingsCache): void {
  const payload: SettingsCache = {
    ...data,
    updated_at: new Date().toISOString(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function mergeTeamsFromExcel(
  excelTeams: string[],
  cache: SettingsCache,
): Record<string, TeamConfig> {
  const old = cache.teams
  const merged: Record<string, TeamConfig> = {}
  for (const team of excelTeams) {
    const prev = old[team]
    const msg = (prev?.message_text || team).trim() || team
    merged[team] = {
      whatsapp_group: (prev?.whatsapp_group || '').trim(),
      send: prev?.send ?? true,
      message_text: msg,
    }
  }
  return merged
}

export function teamsForWhatsapp(teams: Record<string, TeamConfig>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, cfg] of Object.entries(teams)) {
    if (!cfg.send) continue
    const grp = cfg.whatsapp_group.trim()
    if (grp) out[name] = grp
  }
  return out
}

export function messageTextForTeam(teams: Record<string, TeamConfig>, team: string): string {
  const text = (teams[team]?.message_text || team).trim()
  return text || team
}
