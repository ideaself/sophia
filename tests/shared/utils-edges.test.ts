// @vitest-environment jsdom
/**
 * Shared utils — edge branches: malformed storage payloads, empty inputs and
 * multi-line self-test parsing.
 */
import { describe, it, expect, beforeEach } from 'vitest'

import { loadDictPopupPrefs, DEFAULT_DICT_POPUP_PREFS, isEnglishWord } from '../../src/shared/dict'
import { parseEventCard } from '../../src/shared/event-cards'
import {
  applyFontScale,
  getFontScale,
  setFontScale,
  FONT_SCALE_OPTIONS
} from '../../src/shared/font-scale'
import {
  citationMatchesTextbook,
  extractCitations,
  hasTextbookCitation,
  normalizeForMatch,
  verifyCitation,
  verifyCitationNormalized
} from '../../src/shared/grounding'
import { applyNotesToHtml } from '../../src/shared/reading-notes-utils'
import { parseSelfTestQuestions } from '../../src/shared/self-test-utils'
import { parsePersistedTabs } from '../../src/shared/tab-persistence'
import { loadTextTemplates, saveTextTemplates } from '../../src/shared/text-templates'
import { loadThinkingMode, saveThinkingMode } from '../../src/shared/thinking'
import {
  DEFAULT_VOICE_TRIGGERS,
  loadVoiceTriggers,
  saveVoiceTriggers
} from '../../src/shared/voice-trigger'

beforeEach(() => {
  localStorage.clear()
})

describe('dict', () => {
  it('falls back to defaults for malformed popup prefs', () => {
    localStorage.setItem('sophia.dictPopupPrefs', '{not json')
    expect(loadDictPopupPrefs()).toEqual(DEFAULT_DICT_POPUP_PREFS)
  })

  it('recognizes plain English words only', () => {
    expect(isEnglishWord('entropy')).toBe(true)
    expect(isEnglishWord('熵')).toBe(false)
  })
})

describe('event cards', () => {
  it('requires a non-empty quoted body', () => {
    expect(parseEventCard('> 💡 导师提示\n>   \n')).toBeNull()
  })
})

describe('font scale', () => {
  it('defaults to standard for unknown stored values', () => {
    localStorage.setItem('sophia.fontScale', 'gigantic')
    expect(getFontScale()).toBe('standard')
    expect(FONT_SCALE_OPTIONS.length).toBeGreaterThan(0)
  })

  it('falls back to 16px for an unknown scale key', () => {
    applyFontScale('gigantic' as never)
    expect(document.documentElement.style.fontSize).toBe('16px')
  })

  it('applies a stored scale and defaults applyFontScale to it', () => {
    localStorage.setItem('sophia.fontScale', 'large')
    expect(getFontScale()).toBe('large')

    applyFontScale()
    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('setFontScale persists the choice and applies it', () => {
    setFontScale('xlarge')
    expect(localStorage.getItem('sophia.fontScale')).toBe('xlarge')
    expect(document.documentElement.style.fontSize).toBe('20px')
  })
})

describe('grounding', () => {
  it('rejects empty citations and empty textbook text', () => {
    expect(citationMatchesTextbook({ marker: '', quoted: '' }, '教材内容')).toBe(false)
    expect(citationMatchesTextbook({ marker: '', quoted: '很长的引用内容片段' }, '')).toBe(false)
    expect(hasTextbookCitation('没有任何出处')).toBe(false)
  })

  it('extracts citation blocks and skips markers without a quoted body', () => {
    expect(extractCitations('> 【教材出处 · 《高等数学》 · 第3章】\n普通文字')).toEqual([])
    expect(
      extractCitations('> 【教材出处 · 《高等数学》 · 第3章】\n> 引文内容')
    ).toEqual([{ marker: '【教材出处 · 《高等数学》 · 第3章】', quoted: '引文内容' }])
  })

  it('classifies citations as verified, mismatch or unverifiable', () => {
    const citation = { marker: '【教材出处 · 《高等数学》 · 第3章】', quoted: '熵是状态函数' }
    expect(verifyCitation(citation, '第三章：熵是状态函数，用于描述系统的混乱度')).toBe('verified')
    expect(verifyCitation(citation, '完全无关的教材内容')).toBe('mismatch')
    expect(verifyCitation({ marker: citation.marker, quoted: '熵' }, '熵是状态函数')).toBe(
      'unverifiable'
    )
    // 已规范化文本的快路径与全量规范化结果一致。
    expect(verifyCitationNormalized(citation, normalizeForMatch('熵是状态函数'))).toBe('verified')
    expect(citationMatchesTextbook(citation, '完全无关的教材内容')).toBe(false)
  })
})

describe('reading notes html', () => {
  it('skips notes with unsupported types or empty content', () => {
    const html = '<p>熵是状态函数</p>'
    const notes = [
      { position: '1', type: 'bookmark', content: '熵' },
      { position: '1', type: 'highlight', content: '   ' }
    ]

    expect(applyNotesToHtml(html, notes as never, 1)).toBe(html)
  })

  it('highlights a matching note', () => {
    const out = applyNotesToHtml('<p>熵是状态函数</p>', [
      { position: '1', type: 'highlight', content: '状态函数' }
    ] as never, 1)
    expect(out).toContain('状态函数')
    expect(out.length).toBeGreaterThan('<p>熵是状态函数</p>'.length)
  })
})

describe('self-test parsing', () => {
  it('extends hints with indented continuation lines', () => {
    const content = [
      '**自测 1：什么是熵？**',
      '- 提示 1：与无序度有关',
      '  更精确地说，它是一个状态函数',
      '- 答案：无序度的度量'
    ].join('\n')

    const questions = parseSelfTestQuestions(content)

    expect(questions).toHaveLength(1)
    expect(questions[0].hints[0]).toContain('更精确地说')
  })
})

describe('tab persistence', () => {
  it('rejects junk tab entries and empty tab lists', () => {
    expect(parsePersistedTabs(null)).toBeNull()
    expect(parsePersistedTabs('{"tabs":[]}')).toBeNull()
    expect(parsePersistedTabs('{"tabs":[null,42,"x"]}')).toBeNull()
  })

  it('normalizes partial tab records', () => {
    const parsed = parsePersistedTabs('{"tabs":[{"title":"标题"}],"activeIdx":9}')
    expect(parsed).toMatchObject({
      tabs: [{ title: '标题', conversationId: null, input: '' }],
      activeIdx: 0
    })
  })

  it('defaults a missing activeIdx to the first tab', () => {
    const parsed = parsePersistedTabs('{"tabs":[{"title":"A","conversationId":"c1"}]}')
    expect(parsed?.activeIdx).toBe(0)
  })
})

describe('text templates', () => {
  it('returns [] for malformed storage payloads', () => {
    localStorage.setItem('sophia.textTemplates', '{bad json')
    expect(loadTextTemplates()).toEqual([])

    localStorage.setItem('sophia.textTemplates', '{"not":"an array"}')
    expect(loadTextTemplates()).toEqual([])

    saveTextTemplates(['模板'])
    expect(loadTextTemplates()).toEqual(['模板'])
  })
})

describe('thinking mode', () => {
  it('parses the stored on/off flags', () => {
    localStorage.setItem('sophia.thinkingEnabled', '1')
    expect(loadThinkingMode()).toBe('on')
    localStorage.setItem('sophia.thinkingEnabled', '0')
    expect(loadThinkingMode()).toBe('off')

    saveThinkingMode('on')
    expect(localStorage.getItem('sophia.thinkingEnabled')).toBe('1')
  })

  it('persists off and auto modes', () => {
    saveThinkingMode('off')
    expect(localStorage.getItem('sophia.thinkingEnabled')).toBe('0')
    saveThinkingMode('auto')
    expect(localStorage.getItem('sophia.thinkingEnabled')).toBe('auto')
    expect(loadThinkingMode()).toBe('auto')
  })
})

describe('voice triggers', () => {
  it('trims stored triggers and falls back for junk', () => {
    localStorage.setItem('sophia.voiceTriggers', JSON.stringify({ send: '  开始  ', clear: '' }))
    const loaded = loadVoiceTriggers()
    expect(loaded.send).toBe('开始')
    expect(loaded.clear).toBeTruthy()

    localStorage.setItem('sophia.voiceTriggers', '{bad json')
    expect(loadVoiceTriggers().send).toBeTruthy()
  })

  it('trims both stored triggers and falls back for non-string values', () => {
    localStorage.setItem(
      'sophia.voiceTriggers',
      JSON.stringify({ send: ' 开始 ', clear: ' 停下 ' })
    )
    expect(loadVoiceTriggers()).toEqual({ send: '开始', clear: '停下' })

    localStorage.setItem('sophia.voiceTriggers', JSON.stringify({ send: 42, clear: '   ' }))
    expect(loadVoiceTriggers()).toEqual(DEFAULT_VOICE_TRIGGERS)
  })

  it('returns defaults when nothing was stored', () => {
    localStorage.removeItem('sophia.voiceTriggers')
    expect(loadVoiceTriggers()).toEqual(DEFAULT_VOICE_TRIGGERS)
  })

  it('round-trips saved triggers through storage', () => {
    saveVoiceTriggers({ send: '发射', clear: '清除' })
    expect(loadVoiceTriggers()).toEqual({ send: '发射', clear: '清除' })
  })
})
