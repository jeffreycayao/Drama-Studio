const { parentPort, workerData } = require('worker_threads')
const { pathToFileURL } = require('url')
const { createAnalysisProcessState, decodeAnalysisAudio } = require('./audioAnalysisCore.cjs')

const state = createAnalysisProcessState((action, pid) => parentPort.postMessage({ type: `child-${action}`, pid }))
parentPort.on('message', (message) => { if (message?.type === 'cancel') state.cancel() })
parentPort.on('close', () => state.cancel())

async function run() {
  try {
    const { analyzeAudioBuffer } = await import(pathToFileURL(workerData.dspPath).href)
    const audioBuffer = await decodeAnalysisAudio({ ...workerData, state })
    // The native decoder already applied the trim window. DSP result times
    // remain relative to the analyzed window, as they were before migration.
    const { startSeconds, endSeconds, ...dspOptions } = workerData.options
    const analysis = analyzeAudioBuffer(audioBuffer, dspOptions)
    if (analysis.error) throw new Error(analysis.error)
    parentPort.postMessage({ type: 'result', result: { success: true, analysis } })
  } catch (error) {
    parentPort.postMessage({ type: 'result', result: {
      success: false, error: error?.message || 'Audio analysis failed.', code: error?.code || 'AUDIO_ANALYSIS_FAILED',
    } })
  } finally {
    state.cancel()
    parentPort.close()
  }
}

run()
