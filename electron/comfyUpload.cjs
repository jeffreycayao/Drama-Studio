'use strict'

/**
 * Upload a local file to ComfyUI's /upload/image straight from disk (main
 * process). fs.openAsBlob gives a file-backed Blob that fetch reads in pieces
 * while sending, so a multi-gigabyte video never sits in memory; reading it
 * into the renderer fails over 2 GB and holds the file twice under that.
 */

const fs = require('fs')
const path = require('path')

const safeUploadName = (value, fallback) =>
  path.basename(String(value || fallback)).replace(/[^a-zA-Z0-9_\-.\s]/g, '_').slice(0, 180) || fallback

async function uploadLocalFileToComfy({ endpoint, filePath, filename, subfolder = '', type = 'input' }, { fetch = globalThis.fetch, openAsBlob = fs.openAsBlob } = {}) {
  let base
  try { base = new URL(String(endpoint || '')) } catch { throw new Error('ComfyUI address is not valid.') }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('ComfyUI address must be http or https.')
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Upload needs an absolute file path.')
  const blob = await openAsBlob(filePath)
  const form = new FormData()
  form.append('image', blob, safeUploadName(filename, path.basename(filePath)))
  if (subfolder) form.append('subfolder', String(subfolder))
  form.append('type', type === 'temp' ? 'temp' : 'input')
  form.append('overwrite', 'true')
  const response = await fetch(new URL('upload/image', base.href.endsWith('/') ? base.href : `${base.href}/`), { method: 'POST', body: form })
  if (!response.ok) throw new Error(`Failed to upload file: ${response.status} - ${await response.text().catch(() => '')}`)
  return response.json()
}

function registerComfyUploadIpc(ipcMain, deps) {
  ipcMain.handle('comfy:uploadLocalFile', async (_event, input = {}) => {
    try {
      return { success: true, result: await uploadLocalFileToComfy(input, deps) }
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  })
}

module.exports = { registerComfyUploadIpc, uploadLocalFileToComfy }
