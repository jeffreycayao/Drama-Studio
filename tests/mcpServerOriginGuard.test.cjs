'use strict'
// Real loopback HTTP against the actual MCP server class: browsers (Origin,
// simple text/plain POSTs) and DNS-rebound Hosts are refused; CLI-style
// JSON-RPC clients still work. No app, renderer or project is involved.
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createComfyStudioMcpServer } = require('../electron/mcpServer.js')

function post(port, { headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers }, (res) => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const listTools = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
const callTool = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'undo', arguments: {} } })

test('MCP server refuses browser origins, simple requests and rebound hosts', async () => {
  const actions = []
  const server = createComfyStudioMcpServer({ port: 0, version: 'test', performAction: async (request) => { actions.push(request); return { success: true } } })
  await server.start()
  const port = server.server.address().port
  try {
    const json = { 'Content-Type': 'application/json', Host: `127.0.0.1:${port}` }
    const ok = await post(port, { headers: json, body: listTools })
    assert.equal(ok.status, 200)
    assert.ok(JSON.parse(ok.text).result.tools.length > 10)
    assert.equal(ok.headers['access-control-allow-origin'], undefined)

    const fromSite = await post(port, { headers: { ...json, Origin: 'https://evil.example' }, body: callTool })
    assert.equal(fromSite.status, 403)
    const simple = await post(port, { headers: { 'Content-Type': 'text/plain', Host: `127.0.0.1:${port}` }, body: callTool })
    assert.equal(simple.status, 403)
    const rebound = await post(port, { headers: { ...json, Host: `attacker.example:${port}` }, body: callTool })
    assert.equal(rebound.status, 403)
    const nullOrigin = await post(port, { headers: { ...json, Origin: 'null' }, body: callTool })
    assert.equal(nullOrigin.status, 403)
    assert.equal(actions.length, 0, 'no refused request reached the renderer bridge')

    const localhost = await post(port, { headers: { ...json, Host: `localhost:${port}` }, body: listTools })
    assert.equal(localhost.status, 200)
  } finally { await server.stop() }
})

test('an explicitly allowed origin is accepted', async () => {
  process.env.DRAMA_STUDIO_MCP_ALLOWED_ORIGINS = 'http://127.0.0.1:7777'
  const server = createComfyStudioMcpServer({ port: 0, version: 'test' })
  await server.start()
  const port = server.server.address().port
  try {
    const result = await post(port, { headers: { 'Content-Type': 'application/json', Host: `127.0.0.1:${port}`, Origin: 'http://127.0.0.1:7777' }, body: listTools })
    assert.equal(result.status, 200)
  } finally { delete process.env.DRAMA_STUDIO_MCP_ALLOWED_ORIGINS; await server.stop() }
})
