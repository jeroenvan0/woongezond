import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyResendWebhook, plainBody, bareAddress } from '@/lib/support/resendInbound'
import { parseReply, buildSystemPrompt } from '@/lib/support/assistant'

const secretB64 = Buffer.from('een-geheime-sleutel-van-32-bytes!!').toString('base64')
const secret = `whsec_${secretB64}`
const sign = (id: string, ts: string, body: string) => createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${id}.${ts}.${body}`).digest('base64')

describe('verifyResendWebhook', () => {
  const body = '{"type":"email.received"}'
  const now = 1_800_000_000_000
  const ts = String(Math.floor(now / 1000))

  it('accepts a valid v1 signature within tolerance', () => {
    const sig = `v1,${sign('msg_1', ts, body)}`
    expect(verifyResendWebhook({ id: 'msg_1', timestamp: ts, signature: sig }, body, secret, now)).toBe(true)
  })
  it('accepts when one of several signatures matches', () => {
    const sig = `v1,AAAA v1,${sign('msg_1', ts, body)}`
    expect(verifyResendWebhook({ id: 'msg_1', timestamp: ts, signature: sig }, body, secret, now)).toBe(true)
  })
  it('rejects a tampered body, a wrong secret, a stale timestamp, and missing headers', () => {
    const sig = `v1,${sign('msg_1', ts, body)}`
    expect(verifyResendWebhook({ id: 'msg_1', timestamp: ts, signature: sig }, body + ' ', secret, now)).toBe(false)
    expect(verifyResendWebhook({ id: 'msg_1', timestamp: ts, signature: sig }, body, 'whsec_' + Buffer.from('x').toString('base64'), now)).toBe(false)
    expect(verifyResendWebhook({ id: 'msg_1', timestamp: ts, signature: sig }, body, secret, now + 10 * 60 * 1000)).toBe(false)
    expect(verifyResendWebhook({ id: null, timestamp: ts, signature: sig }, body, secret, now)).toBe(false)
    expect(verifyResendWebhook({ id: 'msg_1', timestamp: ts, signature: sig }, body, undefined, now)).toBe(false)
  })
})

describe('plainBody / bareAddress', () => {
  it('strips quoted history and HTML', () => {
    expect(plainBody({ text: 'Dank!\n\nOp 6 sep 2026 schreef Woongezond <hulp@woongezond.com>:\n> oud bericht', html: null })).toBe('Dank!')
    expect(plainBody({ text: null, html: '<p>Hoi</p><p>Werkt <b>niet</b></p>' })).toBe('Hoi\nWerkt niet')
  })
  it('normalises addresses', () => {
    expect(bareAddress('Jeroen <Jeroen@Example.COM>')).toBe('jeroen@example.com')
    expect(bareAddress('x@y.nl')).toBe('x@y.nl')
  })
})

describe('assistant', () => {
  it('parses the model JSON, also when wrapped in prose', () => {
    expect(parseReply('Hier is het:\n{"reply":"Hoi!","escalate":true,"reason":"schimmel"}')).toEqual({ reply: 'Hoi!', escalate: true, reason: 'schimmel' })
    expect(parseReply('geen json')).toBeNull()
    expect(parseReply('{"reply":""}')).toBeNull()
  })
  it('never exposes measurements for an unknown sender', () => {
    const p = buildSystemPrompt({ known: false, firstName: null, deviceNumber: null, room: null, online: null, lastSeenMinutesAgo: null, fwVersion: null, profileSummary: null, weekSummary: 'CO₂ 1200 ppm' }, 'maandag')
    expect(p).toContain('NIET gekoppeld')
    expect(p).not.toContain('1200 ppm')
  })
})
