// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { APP_VERSION, shouldShowReleaseNotes, markReleaseNotesSeen, getReleaseNotes } from './appVersion'

describe('appVersion', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should show release notes when last seen differs', () => {
    localStorage.setItem('inkark-last-seen-version', '0.9.4')
    expect(shouldShowReleaseNotes()).toBe(true)
  })

  it('should hide release notes after marking seen', () => {
    markReleaseNotesSeen()
    expect(shouldShowReleaseNotes()).toBe(false)
    expect(localStorage.getItem('inkark-last-seen-version')).toBe(APP_VERSION)
  })

  it('returns release notes for current version', () => {
    const sections = getReleaseNotes()
    expect(sections.length).toBeGreaterThan(0)
    expect(sections[0].items.length).toBeGreaterThan(0)
  })
})
