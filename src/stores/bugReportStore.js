/** Report a bug dialog: opened from the top bar, the welcome screen, Ctrl+Shift+P and Settings › Send Feedback. */
import { create } from 'zustand'

const useBugReportStore = create((set) => ({
  open: false,
  openBugReport: () => set({ open: true }),
  closeBugReport: () => set({ open: false }),
}))

export const openBugReport = () => useBugReportStore.getState().openBugReport()

export default useBugReportStore
