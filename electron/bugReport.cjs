'use strict'

/**
 * Report a bug (main process): opens this repository's new-issue page in the
 * user's browser, filled in with the title and text from the in-app dialog.
 * The user reviews it and clicks Submit on GitHub with their own account, so
 * the app holds no GitHub token. Only this repository's /issues/new is ever
 * opened; the renderer sends text, never a URL.
 */

const NEW_ISSUE_URL = 'https://github.com/jeffreycayao/Drama-Studio/issues/new'
// Browsers and GitHub reject very long URLs; stay well under 8 KB.
const MAX_URL_LENGTH = 7000
const TRUNCATED_NOTE = '\n\n_…the rest did not fit in the link. Paste it here if it matters._'

function buildNewIssueUrl({ title, body }) {
  const cleanTitle = String(title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
  let text = String(body || '')
  const make = (value) => `${NEW_ISSUE_URL}?${new URLSearchParams({ labels: 'bug', title: cleanTitle, body: value })}`
  let url = make(text)
  let truncated = false
  while (url.length > MAX_URL_LENGTH && text.length > 0) {
    truncated = true
    const over = url.length - MAX_URL_LENGTH
    text = text.slice(0, Math.max(0, text.length - Math.max(200, Math.ceil(over / 3))))
    url = make(text + TRUNCATED_NOTE)
  }
  return { url, truncated }
}

function registerBugReportIpc(ipcMain, { openExternal }) {
  ipcMain.handle('bugReport:open', async (_event, input) => {
    const title = typeof input?.title === 'string' ? input.title : ''
    const body = typeof input?.body === 'string' ? input.body : ''
    if (title.trim().length < 5) return { success: false, error: 'Add a short title first.' }
    const { url, truncated } = buildNewIssueUrl({ title, body })
    try {
      await openExternal(url)
      return { success: true, truncated }
    } catch (error) {
      return { success: false, error: error?.message || 'The browser could not be opened.' }
    }
  })
}

module.exports = { MAX_URL_LENGTH, NEW_ISSUE_URL, buildNewIssueUrl, registerBugReportIpc }
