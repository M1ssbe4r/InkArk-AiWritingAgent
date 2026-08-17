import { describe, it, expect } from 'vitest'
import { redactEntry, errorToObject } from '../redaction'

describe('redaction - 字段名黑名单(整字段 REDACTED)', () => {
  it.each([
    'apiKey', 'api_key', 'apikey',
    'authorization',
    'password', 'passwd', 'pwd',
    'token', 'accessToken', 'refreshToken',
    'secret', 'clientSecret',
    'privateKey', 'priv_key',
  ])('整字段替换 apiKey 类字段名: %s', (field) => {
    const r = redactEntry({ msg: 'x', data: { [field]: 'sk-abcdefghijklmnop1234567890' } })
    expect(r.data?.[field]).toBe('***REDACTED***')
  })
})

describe('redaction - 字段名 OMIT 集合(整字段 OMITTED)', () => {
  it.each([
    'messages', 'prompt', 'systemPrompt',
    'content', 'chapterContent', 'outline',
    'style_guidance', 'guidance',
    'description', 'background', 'appearance',
    'tools', 'text', 'fullText',
  ])('整字段替换为 OMITTED: %s', (field) => {
    const r = redactEntry({ msg: 'x', data: { [field]: '任何内容都丢掉' } })
    expect(r.data?.[field]).toBe('***OMITTED***')
  })

  it('"message"(单数)不在 OMIT 集合 - 普通字符串字段,走 redactString', () => {
    // 修复 bug:之前 'message' 在 OMIT 集合,导致 Error.message / log message 等
    // 普通字符串也被吞掉,排查日志时关键错误信息丢失。
    // 现在 'message' 走 redactString,只命中敏感 pattern 才替换。
    const r = redactEntry({ msg: 'x', data: { message: 'connect ECONNREFUSED' } })
    expect(r.data?.message).toBe('connect ECONNREFUSED')
  })
})

describe('redaction - 字符串值正则(在任意字符串中抓)', () => {
  it('替换 sk- 开头的 API key', () => {
    const r = redactEntry({ msg: '请求出错 sk-abc123def456ghi789jkl012mno' })
    expect(r.msg).not.toContain('sk-abc123')
    expect(r.msg).toContain('***REDACTED***')
  })
  it('替换 Bearer token', () => {
    const r = redactEntry({ msg: 'auth header: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature' })
    expect(r.msg).toContain('Bearer ***REDACTED***')
    expect(r.msg).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })
  it('替换邮箱地址', () => {
    const r = redactEntry({ msg: '用户 user@example.com 反馈' })
    expect(r.msg).not.toContain('user@example.com')
    expect(r.msg).toContain('***REDACTED***')
  })
  it('不误伤普通短字符串', () => {
    const r = redactEntry({ msg: 'projectId: p_abc123, status: ok' })
    expect(r.msg).toBe('projectId: p_abc123, status: ok')
  })
})

describe('redaction - 嵌套对象递归', () => {
  it('深嵌套也覆盖', () => {
    const r = redactEntry({
      msg: 'x',
      data: {
        request: {
          headers: { authorization: 'Bearer abc...' },
          body: { apiKey: 'sk-xxx', content: '章节正文,小说内容' },
        },
      },
    })
    expect(r.data?.request).toMatchObject({
      headers: { authorization: '***REDACTED***' },
      body: { apiKey: '***REDACTED***', content: '***OMITTED***' },
    })
  })

  it('数组里的对象也覆盖', () => {
    const r = redactEntry({
      msg: 'x',
      data: { messages: [{ role: 'user', content: '段落1' }, { role: 'assistant', content: '段落2' }] },
    })
    // 数组里每个对象都过 redactValue,字段名 'content' 命中 OMIT
    expect(JSON.stringify(r.data)).toContain('***OMITTED***')
    expect(JSON.stringify(r.data)).not.toContain('段落1')
    expect(JSON.stringify(r.data)).not.toContain('段落2')
  })
})

describe('redaction - 错误对象序列化', () => {
  it('Error 实例拆 name/message/stack', () => {
    const err = new Error('boom')
    const obj = errorToObject(err)
    expect(obj.name).toBe('Error')
    expect(obj.message).toBe('boom')
    expect(typeof obj.stack).toBe('string')
  })
  it('栈里的 token 也要被 redact - 这条通过整条 entry 走 redactEntry 验证', () => {
    const err = new Error('failed: Bearer eyJhbGciOiabcdefghij1234567890')
    const obj = errorToObject(err)
    // errorToObject 本身不脱敏,但日志写入路径会用 redactEntry 整体过
    const r = redactEntry({ msg: 'err', data: { error: obj } })
    expect(JSON.stringify(r.data)).not.toContain('eyJhbGciOi')
  })
  it('字符串也支持', () => {
    expect(errorToObject('plain string')).toEqual({ message: 'plain string' })
  })
})

describe('redaction - 输入极值', () => {
  it('空字符串不报错', () => {
    const r = redactEntry({ msg: '' })
    expect(r.msg).toBe('')
  })
  it('data 为 undefined 保持 undefined', () => {
    const r = redactEntry({ msg: 'x' })
    expect(r.data).toBeUndefined()
  })
  it('null 字段保留', () => {
    const r = redactEntry({ msg: 'x', data: { x: null } })
    expect(r.data?.x).toBeNull()
  })
  it('数字/布尔 不被破坏', () => {
    const r = redactEntry({ msg: 'x', data: { count: 42, ok: true } })
    expect(r.data).toMatchObject({ count: 42, ok: true })
  })
})