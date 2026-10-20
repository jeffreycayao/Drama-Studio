import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { planDetection, planLauncher } from './comfySetupGateFlow.mjs'

const install = (root, source = 'scan') => ({ root, source, label: '' })

test('a single detected folder (even from a drive scan) is shown for confirmation, not accepted', () => {
  const plan = planDetection({ installs: [install('D:\\ComfyUI')], servers: [] }, { allowScan: true })
  assert.deepEqual(plan, { kind: 'confirm', installs: [install('D:\\ComfyUI')] })
  const desktop = planDetection({ installs: [install('C:\\Users\\a\\Documents\\ComfyUI', 'comfy-desktop')], servers: [{ port: 8000 }] })
  assert.equal(desktop.kind, 'confirm', 'a folder still needs a click when a server is also running')
})

test('several folders are offered as a choice; blank roots are dropped', () => {
  const plan = planDetection({ installs: [install('A:\\ComfyUI'), install(''), null, install('B:\\ComfyUI', 'running')] })
  assert.equal(plan.kind, 'confirm')
  assert.deepEqual(plan.installs.map(entry => entry.root), ['A:\\ComfyUI', 'B:\\ComfyUI'])
})

test('a running server with no folder is connected without a question', () => {
  assert.deepEqual(planDetection({ installs: [], servers: [{ port: '8188' }] }), { kind: 'connect', port: 8188 })
  assert.deepEqual(planDetection({ installs: [], servers: [{ port: 'x' }] }, { allowScan: false }), { kind: 'missing' })
})

test('nothing found: scan when allowed, otherwise show install help', () => {
  assert.deepEqual(planDetection({}, { allowScan: true }), { kind: 'scan' })
  assert.deepEqual(planDetection(null), { kind: 'missing' })
})

test('detected launcher scripts are offered, never picked automatically', () => {
  const candidates = [{ path: 'D:\\run_nvidia_gpu.bat', label: 'Portable NVIDIA GPU launcher' }, { path: 'D:\\run_cpu.bat', label: 'CPU' }]
  assert.deepEqual(planLauncher({ config: { launcherScript: '' }, detected: { candidates } }), { kind: 'confirm', candidates })
  assert.deepEqual(planLauncher({ config: { launcherScript: 'C:\\mine.bat' }, detected: { candidates } }), { kind: 'keep' })
  assert.deepEqual(planLauncher({ config: {}, detected: { candidates: [{ path: ' ' }] } }), { kind: 'none' })
  assert.deepEqual(planLauncher({}), { kind: 'none' })
})

test('the gate saves a folder or launcher only from a click handler', () => {
  const source = readFileSync(new URL('../components/ComfySetupGate.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /candidates\?\.\[0\]/, 'no silent first-candidate launcher')
  const detection = source.slice(source.indexOf('const applyDetection'), source.indexOf('const runDetection'))
  assert.ok(detection.length > 0)
  assert.doesNotMatch(detection, /acceptRoot|setConfig|setSetting/, 'detection only lists folders; it saves nothing from disk')
  // setConfig appears once, inside saveLauncher, which only the buttons call.
  assert.equal(source.match(/comfyLauncher\.setConfig/g)?.length, 1)
  assert.match(source, /const saveLauncher = useCallback/)
})

test('cloud only passes the gate until ComfyUI is set up', async () => {
  const { gatePasses, isCloudOnlyStatus, CLOUD_ONLY_VIA } = await import('./comfySetupGateFlow.mjs')
  assert.equal(gatePasses({ confirmedVia: CLOUD_ONLY_VIA }), true)
  assert.equal(isCloudOnlyStatus({ confirmedVia: CLOUD_ONLY_VIA }), true)
  assert.equal(isCloudOnlyStatus({ confirmedVia: CLOUD_ONLY_VIA, rootLooksValid: true }), false, 'a valid folder wins')
  assert.equal(isCloudOnlyStatus({ confirmedVia: CLOUD_ONLY_VIA, skipGate: true }), false)
  assert.equal(gatePasses({ confirmedVia: 'server' }), true)
  assert.equal(gatePasses({ rootLooksValid: true }), true)
  assert.equal(gatePasses({ skipGate: true }), true)
  assert.equal(gatePasses({ confirmedVia: '' }), false)
  assert.equal(gatePasses(null), false)
})
