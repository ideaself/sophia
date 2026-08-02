/**
 * Voice input trigger words (2.0.0).
 *
 * With system/third-party dictation, the learner can type by voice into the
 * classroom input. Two configurable trigger phrases make it hands-free:
 * - 「发送」 phrase: strip it from the text and send the message.
 * - 「清空」 phrase: strip it and clear the input.
 */

export interface VoiceTriggers {
  send: string
  clear: string
}

export const DEFAULT_VOICE_TRIGGERS: VoiceTriggers = {
  send: '发送',
  clear: '清空'
}

const STORAGE_KEY = 'sophia.voiceTriggers'

export function loadVoiceTriggers(): VoiceTriggers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_VOICE_TRIGGERS }
    const parsed = JSON.parse(raw) as Partial<VoiceTriggers>
    return {
      send: typeof parsed.send === 'string' && parsed.send.trim() ? parsed.send.trim() : DEFAULT_VOICE_TRIGGERS.send,
      clear: typeof parsed.clear === 'string' && parsed.clear.trim() ? parsed.clear.trim() : DEFAULT_VOICE_TRIGGERS.clear
    }
  } catch {
    return { ...DEFAULT_VOICE_TRIGGERS }
  }
}

export function saveVoiceTriggers(triggers: VoiceTriggers): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(triggers))
  } catch {
    // storage disabled — best-effort
  }
}

export interface TriggerDetection {
  action: 'send' | 'clear' | null
  /** The text with the matched trigger phrase removed (trailing whitespace trimmed). */
  stripped: string
}

/** Detect a trailing trigger phrase. Returns the action and the cleaned text. */
export function detectVoiceTrigger(text: string, triggers: VoiceTriggers = loadVoiceTriggers()): TriggerDetection {
  const trimmed = text.trimEnd()
  if (triggers.send && trimmed.endsWith(triggers.send)) {
    return { action: 'send', stripped: trimmed.slice(0, -triggers.send.length).trimEnd() }
  }
  if (triggers.clear && trimmed.endsWith(triggers.clear)) {
    return { action: 'clear', stripped: trimmed.slice(0, -triggers.clear.length).trimEnd() }
  }
  return { action: null, stripped: text }
}
