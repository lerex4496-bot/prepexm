#!/usr/bin/env node
// Screenshot the running Octogent dashboard (or any local URL).
//
//   node .claude/skills/octogent/shot.mjs <out.png> [url]
//
// Why CDP instead of `chrome --headless --screenshot=out.png`: that flag is
// unreliable on this machine — it works sometimes, then fails with
// "Failed to write file: Access is denied (0x5)" in every directory, and Edge
// behaves the same way. Driving DevTools ourselves and writing the base64 from
// Node sidesteps Chrome's file writing entirely.
//
// No dependencies: Node 22+ ships a global WebSocket.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = process.argv[2] ?? 'octogent.png'
const URL_ = process.argv[3] ?? 'http://127.0.0.1:8787'
const PORT = 9333
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(join(tmpdir(), 'octogent-shot-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--hide-scrollbars',
    '--window-size=1440,900',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    URL_,
  ],
  { stdio: 'ignore' },
)

const cleanup = () => {
  try {
    chrome.kill()
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}

// The debugging port takes a moment to bind.
let target = null
for (let i = 0; i < 40; i++) {
  await sleep(500)
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const targets = await res.json()
    target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (target) break
  } catch {
    // not listening yet
  }
}

if (!target) {
  cleanup()
  console.error(`devtools never came up on :${PORT} — is ${CHROME} present?`)
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  }
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error('devtools websocket failed')), {
    once: true,
  })
})

try {
  await send('Page.enable')
  // Chrome already navigated from argv; re-navigate so we control the timing.
  await send('Page.navigate', { url: URL_ })
  // Octogent is a React SPA — the load event fires long before the graph paints.
  await sleep(Number(process.env.SETTLE_MS ?? 6000))
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  console.log(`wrote ${OUT} (${Buffer.from(data, 'base64').length} bytes)`)
} catch (err) {
  console.error(`screenshot failed: ${err.message}`)
  process.exitCode = 1
} finally {
  ws.close()
  cleanup()
}
