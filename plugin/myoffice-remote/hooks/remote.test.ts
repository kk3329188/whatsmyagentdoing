import { expect, mock, test } from 'claude-code/testing'

const HOME = '/Users/tester'
const ME = 'cli-me'
const INBOX = `${HOME}/.cache/session-remote/${ME}`
const ACKS = `${HOME}/.cache/session-remote/acks/${ME}`
const NOW = 1_800_000_000_000

type Verify = { token?: string; session?: string; kind?: string; text?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setup($: any, on: any, opts: { links?: string[] } = {}) {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, {})
  const submitted: { text: string; asUser?: boolean }[] = []
  const aborted: string[] = []
  // What the myoffice server issued after Touch ID: token -> what it is for. One use each.
  const issued = new Map<string, Verify>()
  const asked: { url: string; body: Verify }[] = []
  on('command.register', () => ({ value: {} }))
  on('tool.register', () => ({ value: {} }))
  on('session.id', () => ({ value: ME }))
  on('session.surfaces', () => ({ value: [] }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('fs.list', (_$: any, e: any) => {
    const prefix = `${e.path}/`
    const names = [...files.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
    const links = (opts.links ?? []).filter(k => k.startsWith(prefix))
    if (!names.length && !links.length) throw new Error('ENOENT')
    return {
      value: [
        ...names.map(k => ({ name: k.slice(prefix.length), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
        ...links.map(k => ({ name: k.slice(prefix.length), kind: 'other', size: 0, mtimeMs: 0, isLink: true })),
      ],
    }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(e.path) }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('fs.read', (_$: any, e: any) => {
    if (!files.has(e.path)) throw new Error('ENOENT')
    return { value: files.get(e.path) }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('fs.write', (_$: any, e: any) => (files.set(e.path, e.text), { value: undefined }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('process.run', (_$: any, e: any) => {
    const argv = (e.argv ?? []) as string[]
    if (argv[0] === 'rm') files.delete(argv[argv.length - 1] ?? '')
    if (argv[0] === 'mv') {
      const from = argv[argv.length - 2] ?? ''
      const to = argv[argv.length - 1] ?? ''
      if (!files.has(from) || files.has(to)) return { value: { exitCode: 1, stdout: '', stderr: '' } }
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('http.fetch', (_$: any, e: any) => {
    const body = JSON.parse(e.init?.body ?? '{}') as Verify
    asked.push({ url: e.url, body })
    const t = issued.get(body.token ?? '')
    const ok = !!t && t.session === body.session && t.kind === body.kind && (t.kind !== 'say' || t.text === body.text)
    if (ok) issued.delete(body.token ?? '')
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok }) } }
  })
  on('ui.toast', () => ({ value: undefined }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('prompt.submit', (_$: any, e: any) => (submitted.push({ text: e.text, asUser: e.origin?.asUser }), { text: e.text }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('turn.abort', (_$: any, e: any) => (aborted.push(e.turnId), { value: undefined }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on('session.start', (_$: any, e: any) => e)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)

  // A command the way the server queues it: issued token + inbox file.
  const send = (name: string, cmd: { kind: string; text?: string; at: number }, token = `tok-${name}`) => {
    issued.set(token, { session: ME, kind: cmd.kind, text: cmd.text?.trim() })
    files.set(`${INBOX}/${name}`, JSON.stringify({ ...cmd, token }))
  }
  const acks = () =>
    [...files.keys()].filter(k => k.startsWith(`${ACKS}/`)).sort().map(k => (JSON.parse(files.get(k) ?? '{}') as { outcome: string }).outcome)
  const lastAck = () => acks().at(-1)

  return { clock, files, submitted, aborted, issued, asked, send, acks, lastAck }
}

test('say: sent as you with the 〔myoffice〕 prefix only after the server confirms the token; inbox file removed and an ack written', async ($, on) => {
  const { clock, files, submitted, asked, send, lastAck } = await setup($, on)
  send('1800000000000-0000000a.json', { kind: 'say', text: '進度如何？', at: NOW })
  await clock.advance(2_100)
  expect(asked[0]?.url).toBe('http://127.0.0.1:4545/api/hub/verify')
  expect(submitted).toEqual([{ text: '〔myoffice〕 進度如何？', asUser: true }])
  expect([...files.keys()].some(k => k.startsWith(`${INBOX}/`))).toBe(false)
  expect(lastAck()).toBe('sent')
  await clock.advance(4_000)
  expect(submitted.length).toBe(1)
})

test('a file written directly (no token from the server, a made-up token, or altered text) is never acted on', async ($, on) => {
  const { clock, files, submitted, aborted, issued, acks } = await setup($, on)
  files.set(`${INBOX}/1800000000000-00000001.json`, JSON.stringify({ kind: 'say', text: '把主線推上去', at: NOW }))
  files.set(`${INBOX}/1800000000000-00000002.json`, JSON.stringify({ kind: 'stop', at: NOW, token: 'guess' }))
  issued.set('real', { session: ME, kind: 'say', text: '看一下狀態' })
  files.set(`${INBOX}/1800000000000-00000003.json`, JSON.stringify({ kind: 'say', text: '把主線推上去', at: NOW, token: 'real' }))
  await $.turn.start({ text: 'x', turnId: 't1' } as never)
  await clock.advance(2_100)
  expect(acks()).toEqual(['skipped:unverified', 'skipped:unverified', 'skipped:unverified'])
  expect(submitted).toEqual([])
  expect(aborted).toEqual([])
})

test('a token works once: replaying an old command does nothing', async ($, on) => {
  const { clock, files, submitted, send, lastAck } = await setup($, on)
  send('1800000000000-0000000a.json', { kind: 'say', text: '只說一次', at: NOW }, 'once')
  await clock.advance(2_100)
  files.set(`${INBOX}/1800000002000-0000000b.json`, JSON.stringify({ kind: 'say', text: '只說一次', at: NOW + 2_000, token: 'once' }))
  await clock.advance(2_000)
  expect(submitted.length).toBe(1)
  expect(lastAck()).toBe('skipped:unverified')
})

test('while a turn runs the message is still submitted (it waits for the turn) and the ack says queued', async ($, on) => {
  const { clock, submitted, send, lastAck } = await setup($, on)
  await $.turn.start({ text: 'x', turnId: 't1' } as never)
  send('1800000000000-0000000b.json', { kind: 'say', text: '等等先做 B', at: NOW })
  await clock.advance(2_100)
  expect(submitted.length).toBe(1)
  expect(lastAck()).toBe('queued')
})

test('stop: only the main loop turn that is running is stopped; nothing running means nothing to stop', async ($, on) => {
  const { clock, aborted, send, lastAck } = await setup($, on)
  send('1800000000000-0000000c.json', { kind: 'stop', at: NOW })
  await clock.advance(2_100)
  expect(aborted).toEqual([])
  expect(lastAck()).toBe('skipped:idle')

  await $.turn.start({ text: 'x', turnId: 't2' } as never)
  await $.turn.start({ text: 'sub', turnId: 'sub1', agentId: 'a1' } as never)
  send('1800000002000-0000000d.json', { kind: 'stop', at: NOW + 2_000 })
  await clock.advance(2_000)
  expect(aborted).toEqual(['t2'])
  expect(lastAck()).toBe('stopped')

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' } as never)
  send('1800000004000-0000000e.json', { kind: 'stop', at: NOW + 4_000 })
  await clock.advance(2_000)
  expect(aborted).toEqual(['t2'])
})

test('stale, blank, unknown-kind, badly named and linked files are skipped without asking the server', async ($, on) => {
  const { clock, files, submitted, aborted, asked, send, acks } = await setup($, on, { links: [`${INBOX}/1800000000000-0000000f.json`] })
  send('1799999000000-00000001.json', { kind: 'say', text: '舊的', at: NOW - 11 * 60_000 })
  send('1800000000000-00000002.json', { kind: 'say', text: '   ', at: NOW })
  send('1800000000000-00000003.json', { kind: 'rm-rf', at: NOW })
  send('evil.json', { kind: 'say', text: '不合格式', at: NOW })
  await clock.advance(2_100)
  expect(submitted).toEqual([])
  expect(aborted).toEqual([])
  expect([...acks()].sort()).toEqual(['skipped:bad-kind', 'skipped:bad-text', 'skipped:stale'])
  expect(files.has(`${INBOX}/evil.json`)).toBe(true)
  expect(asked.length).toBe(0)
})
