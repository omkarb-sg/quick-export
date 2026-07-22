import { describe, it, expect } from 'vitest'
import { md5Password, tokenEndpoint, buildTokenForm } from '../../src/aras/oauth.js'

describe('md5Password', () => {
  it('hashes to the Aras-expected lowercase hex (known vector for "innovator")', () => {
    expect(md5Password('innovator')).toBe('607920b64fe136f9ab2389e371852af2')
  })
})

describe('tokenEndpoint', () => {
  it('appends the OAuth path, trimming trailing slashes', () => {
    expect(tokenEndpoint('http://localhost/12sp9')).toBe('http://localhost/12sp9/OAuthServer/connect/token')
    expect(tokenEndpoint('http://localhost/12sp9/')).toBe('http://localhost/12sp9/OAuthServer/connect/token')
  })
})

describe('buildTokenForm', () => {
  it('builds a password grant with the hashed password and defaults', () => {
    const form = buildTokenForm({ url: 'http://x', database: '12sp9', username: 'admin', password: 'innovator' })
    expect(form.get('grant_type')).toBe('password')
    expect(form.get('client_id')).toBe('IOMApp')
    expect(form.get('scope')).toBe('Innovator openid')
    expect(form.get('username')).toBe('admin')
    expect(form.get('database')).toBe('12sp9')
    expect(form.get('password')).toBe('607920b64fe136f9ab2389e371852af2')
  })

  it('honours custom clientId/scope', () => {
    const form = buildTokenForm({
      url: 'http://x',
      database: 'db',
      username: 'u',
      password: 'p',
      clientId: 'MyApp',
      scope: 'Innovator'
    })
    expect(form.get('client_id')).toBe('MyApp')
    expect(form.get('scope')).toBe('Innovator')
  })
})
