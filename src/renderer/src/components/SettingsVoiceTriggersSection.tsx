import { useState } from 'react'
import { CollapsibleSection } from './CollapsibleSection'
import {
  DEFAULT_VOICE_TRIGGERS,
  loadVoiceTriggers,
  saveVoiceTriggers
} from '../../../shared/voice-trigger'

/**
 * 语音输入触发词设置（拆分自 SettingsView）：说出发送/清空短语免手操作。
 */
export function SettingsVoiceTriggersSection(): React.ReactElement {
  const [voiceTriggers, setVoiceTriggers] = useState(() => loadVoiceTriggers())

  const handleVoiceTriggerChange = (field: 'send' | 'clear', value: string) => {
    setVoiceTriggers((prev) => {
      const next = { ...prev, [field]: value }
      saveVoiceTriggers(next)
      return next
    })
  }

  return (
    <>
      <CollapsibleSection title="语音输入触发词">
        <p className="mb-3 text-xs text-text-muted">
          用系统或第三方语音输入（macOS 听写、Windows 系统语音、讯飞输入法等）说话时，
          说完设定好的触发短语即可免手发送或清空消息。
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-16 flex-shrink-0 text-xs text-text-muted">发送</label>
            <input
              type="text"
              value={voiceTriggers.send}
              maxLength={20}
              onChange={(e) => handleVoiceTriggerChange('send', e.target.value)}
              placeholder={`默认：${DEFAULT_VOICE_TRIGGERS.send}`}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
            />
            <span className="flex-shrink-0 text-xs text-text-muted">在输入末尾说出即自动发送</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 flex-shrink-0 text-xs text-text-muted">清空</label>
            <input
              type="text"
              value={voiceTriggers.clear}
              maxLength={20}
              onChange={(e) => handleVoiceTriggerChange('clear', e.target.value)}
              placeholder={`默认：${DEFAULT_VOICE_TRIGGERS.clear}`}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
            />
            <span className="flex-shrink-0 text-xs text-text-muted">在输入末尾说出即清空输入</span>
          </div>
        </div>
      </CollapsibleSection>
    </>
  )
}
