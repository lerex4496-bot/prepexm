#!/usr/bin/env node
/**
 * Drive the StudyMate Expo web build over the Chrome DevTools Protocol.
 *
 *   node .claude/skills/run-studymate-mobile/driver.mjs <out.png> [command...]
 *
 * Commands run in order after the app has painted:
 *   text            dump the visible text of the page
 *   click:<substr>  click the first element whose text contains <substr>
 *   wait:<ms>       sleep
 *   shot:<file>     extra screenshot mid-sequence
 *
 * Example — walk into onboarding and capture each step:
 *   node ...driver.mjs out.png text click:"Get started" wait:1500 shot:step2.png text
 *
 * Why this exists rather than a fixed `sleep` + `chrome --screenshot`:
 *   - Metro's FIRST web bundle of this app takes ~3.5 minutes (1009 modules);
 *     even a warm rebuild took 25s. Any hardcoded settle is a coin flip, so
 *     this polls #root for real content instead.
 *   - `chrome --headless --screenshot=out.png` fails on this machine with
 *     "Access is denied" regardless of target directory, so we capture over
 *     CDP and write the bytes from Node.
 *   - A blank white page is the app's failure mode (fonts/splash/router), and
 *     it looks identical to "still bundling" in a PNG. Console errors are
 *     collected and printed so the two are distinguishable.
 *
 * No dependencies: Node 22+ ships a global WebSocket.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const OUT = argv[0] ?? 'studymate.png'
const COMMANDS = argv.slice(1)
const URL_ = process.env.APP_URL ?? 'http://localhost:8082'
const PORT = Number(process.env.CDP_PORT ?? 9334)
// Metro's cold bundle is minutes, not seconds.
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS ?? 300_000)
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(join(tmpdir(), 'studymate-driver-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--hide-scrollbars',
    // Pixel 5-ish, so the layout is the phone layout and not a desktop one.
    '--window-size=412,915',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
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
process.on('exit', cleanup)

let target = null
for (let i = 0; i < 60; i++) {
  await sleep(500)
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    target = (await res.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (target) break
  } catch {
    /* port not bound yet */
  }
}
if (!target) {
  console.error(`devtools never came up on :${PORT} — is Chrome at ${CHROME}?`)
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const consoleErrors = []

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
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    consoleErrors.push(`[exception] ${d.exception?.description ?? d.text}`)
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    consoleErrors.push(`[console.${msg.params.type}] ${text}`)
  }
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error('devtools websocket failed')), { once: true })
})

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text)
  return result.value
}

const shoot = async (file) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const buf = Buffer.from(data, 'base64')
  writeFileSync(file, buf)
  console.log(`shot ${file} (${buf.length} bytes)`)
}

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_ })

  // expo-router mounts into #root. Poll for real painted content rather than
  // guessing a settle time — the cold bundle can take minutes.
  const started = Date.now()
  let painted = false
  while (Date.now() - started < READY_TIMEOUT_MS) {
    await sleep(2000)
    const len = await evaluate(
      `(() => { const r = document.getElementById('root'); return r ? (r.innerText || '').trim().length : -1 })()`,
    )
    if (len > 0) {
      painted = true
      console.log(`painted after ${Math.round((Date.now() - started) / 1000)}s`)
      break
    }
  }
  if (!painted) {
    console.error(`#root never rendered text within ${READY_TIMEOUT_MS / 1000}s`)
  }
  // Let fonts and the splash-screen hand-off finish.
  await sleep(2500)

  await shoot(OUT)

  for (const cmd of COMMANDS) {
    if (cmd === 'text') {
      console.log('--- visible text ---')
      console.log(await evaluate(`document.getElementById('root')?.innerText ?? '(no #root)'`))
      console.log('--------------------')
    } else if (cmd.startsWith('click:')) {
      const needle = cmd.slice(6)
      const hit = await evaluate(`(() => {
        const want = ${JSON.stringify(needle)};
        const els = [...document.querySelectorAll('div,button,a,span,[role="button"]')];
        // Innermost match wins — outer containers also contain the string.
        const match = els.reverse().find(e => (e.innerText || '').includes(want));
        if (!match) return null;
        match.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        const r = match.getBoundingClientRect();
        return {text: (match.innerText || '').slice(0, 60), x: Math.round(r.x), y: Math.round(r.y)};
      })()`)
      console.log(hit ? `clicked ${JSON.stringify(hit)}` : `NO MATCH for "${needle}"`)
    } else if (cmd.startsWith('wait:')) {
      await sleep(Number(cmd.slice(5)))
    } else if (cmd.startsWith('shot:')) {
      await shoot(cmd.slice(5))
    } else {
      console.error(`unknown command: ${cmd}`)
    }
  }

  if (consoleErrors.length) {
    console.log(`--- ${consoleErrors.length} console error(s)/warning(s) ---`)
    for (const e of consoleErrors.slice(0, 25)) console.log(e)
  }
} catch (err) {
  console.error(`driver failed: ${err.message}`)
  process.exitCode = 1
} finally {
  ws.close()
  cleanup()
}
