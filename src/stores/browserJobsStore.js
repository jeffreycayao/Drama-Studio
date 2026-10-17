/**
 * Browser jobs and capture notices (docs/PLAN_AI_BROWSER_WORKSPACE.md, step 1).
 *
 * The desktop link sends a job summary every time a browser job changes
 * state; this store keeps the latest one per job plus the short notices
 * shown when a capture lands in the project. The job UI is step 3.
 */
import { create } from 'zustand'

const MAX_JOBS = 50
const MAX_NOTICES = 4

const useBrowserJobsStore = create((set) => ({
  jobs: {},
  notices: [],

  applyJobUpdate: (job) => {
    if (!job?.jobId) return
    set((state) => {
      const jobs = { ...state.jobs, [job.jobId]: { ...state.jobs[job.jobId], ...job } }
      const ids = Object.keys(jobs)
      if (ids.length > MAX_JOBS) {
        ids
          .sort((a, b) => (jobs[a].updatedAt || 0) - (jobs[b].updatedAt || 0))
          .slice(0, ids.length - MAX_JOBS)
          .forEach((id) => { delete jobs[id] })
      }
      return { jobs }
    })
  },

  pushNotice: (notice) => {
    const id = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => ({ notices: [...state.notices, { id, tone: 'info', ...notice }].slice(-MAX_NOTICES) }))
    return id
  },

  dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
}))

export default useBrowserJobsStore
