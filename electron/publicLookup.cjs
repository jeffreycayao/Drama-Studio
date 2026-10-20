'use strict'

/**
 * DNS lookup for downloads that must only reach the public internet (stock
 * files, SFX catalogs and files). Checking the URL's hostname text is not
 * enough: a public name can resolve to 127.0.0.1 or a LAN address (for
 * example 127.0.0.1.nip.io), which would reach ComfyUI on :8188 or the MCP
 * server on :19790.
 *
 * Pass `lookup: createPublicLookup()` to http(s).get. Node calls it when it
 * opens the socket, so every address is checked at connect time and the
 * socket connects to an address that passed the check. A DNS answer cannot
 * change between check and connect (rebinding). Redirect hops are new
 * requests and get the same lookup. IP-literal hosts never reach the lookup;
 * `isPrivateHost` on the URL hostname covers those.
 */

const dns = require('dns')
const net = require('net')
const { isPrivateHost } = require('./sfxCatalog.cjs')

class PrivateAddressError extends Error {
  constructor(hostname, address) {
    super('The download address points to a private or local network address.')
    this.code = 'PRIVATE_ADDRESS'
    this.hostname = hostname
    this.address = address
  }
}

function normalizeAddress(address) {
  const version = net.isIP(address)
  if (version === 4) return address
  if (version !== 6) return null
  // Zone ids (fe80::1%eth0) make URL throw; those are link-local anyway.
  try { return new URL(`http://[${address}]/`).hostname.replace(/^\[|\]$/g, '') } catch { return null }
}

function isLoopbackAddress(address) {
  return address === '::1' || /^127\./.test(address)
}

/** True when `address` is a public unicast IP. Not-an-IP is never public. */
function isPublicAddress(address, { allowLoopback = false } = {}) {
  const normalized = normalizeAddress(String(address || ''))
  if (!normalized) return false
  if (allowLoopback && isLoopbackAddress(normalized)) return true
  return !isPrivateHost(normalized)
}

/**
 * A `lookup` for http(s) request options. Resolves all addresses and fails
 * with PRIVATE_ADDRESS when any of them is private, loopback, link-local,
 * CGNAT or multicast. `allowLoopback` is for tests against a local server.
 */
function createPublicLookup({ resolve = dns.lookup, allowLoopback = false } = {}) {
  return function publicLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {} }
    const opts = typeof options === 'number' ? { family: options } : (options || {})
    const query = { all: true }
    if (opts.family) query.family = opts.family
    if (opts.hints) query.hints = opts.hints
    resolve(hostname, query, (error, addresses) => {
      if (error) { callback(error); return }
      const list = (Array.isArray(addresses) ? addresses : [])
        .filter(entry => entry && typeof entry.address === 'string')
        .map(entry => ({ address: entry.address, family: entry.family || net.isIP(entry.address) }))
      if (!list.length) {
        const notFound = new Error(`Could not resolve ${hostname}.`)
        notFound.code = 'ENOTFOUND'
        callback(notFound)
        return
      }
      const blocked = list.find(entry => !isPublicAddress(entry.address, { allowLoopback }))
      if (blocked) { callback(new PrivateAddressError(hostname, blocked.address)); return }
      if (opts.all) callback(null, list)
      else callback(null, list[0].address, list[0].family)
    })
  }
}

module.exports = { PrivateAddressError, createPublicLookup, isPublicAddress }
