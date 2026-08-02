import { describe, it, expect } from 'vitest'
import { detectVoiceTrigger, DEFAULT_VOICE_TRIGGERS } from '../../src/shared/voice-trigger'

const triggers = { send: '发送', clear: '清空' }

describe('detectVoiceTrigger', () => {
  it('detects the send trigger at the end and strips it', () => {
    expect(detectVoiceTrigger('答案是六发送', triggers)).toEqual({ action: 'send', stripped: '答案是六' })
  })

  it('detects the clear trigger at the end and strips it', () => {
    expect(detectVoiceTrigger('这句不要清空', triggers)).toEqual({ action: 'clear', stripped: '这句不要' })
  })

  it('ignores text without a trigger', () => {
    expect(detectVoiceTrigger('普通的一句话', triggers)).toEqual({ action: null, stripped: '普通的一句话' })
  })

  it('does not match a trigger in the middle of the text', () => {
    expect(detectVoiceTrigger('发送这句话吗', triggers)).toEqual({ action: null, stripped: '发送这句话吗' })
  })

  it('handles empty and whitespace-only input', () => {
    expect(detectVoiceTrigger('', triggers)).toEqual({ action: null, stripped: '' })
    expect(detectVoiceTrigger('   ', triggers)).toEqual({ action: null, stripped: '   ' })
  })

  it('uses the default triggers when none are supplied', () => {
    expect(detectVoiceTrigger('收到发送')).toEqual({ action: 'send', stripped: '收到' })
    expect(DEFAULT_VOICE_TRIGGERS.send).toBe('发送')
    expect(DEFAULT_VOICE_TRIGGERS.clear).toBe('清空')
  })
})
