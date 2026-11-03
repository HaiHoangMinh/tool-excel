export type JobStatus = 'completed' | 'partial' | 'failed'

export type JobRecord = {
  id: string
  fileName: string
  startedAt: string
  durationMs: number
  teamsProcessed: number
  imagesOk: number
  imagesSkip: number
  status: JobStatus
  note: string
}

const KEY = 'tool-excel-job-history'
const MAX = 50

export function loadJobHistory(): JobRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as JobRecord[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function appendJob(record: JobRecord): JobRecord[] {
  const prev = loadJobHistory()
  const next = [record, ...prev].slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function jobStats(jobs: JobRecord[]) {
  const filesProcessed = jobs.length
  const completed = jobs.filter((j) => j.status === 'completed').length
  const failed = jobs.filter((j) => j.status === 'failed').length
  const imagesSent = jobs.reduce((s, j) => s + j.imagesOk, 0)
  return { filesProcessed, completed, failed, imagesSent, partial: jobs.filter((j) => j.status === 'partial').length }
}
