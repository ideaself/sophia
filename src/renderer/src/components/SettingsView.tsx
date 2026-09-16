import { ThemeSwitcher } from './ThemeSwitcher'
import { SettingsFontScaleSection } from './SettingsFontScaleSection'
import { SettingsLockSection } from './SettingsLockSection'
import { SettingsClassroomBehaviorSection } from './SettingsClassroomBehaviorSection'
import { SettingsTextTemplatesSection } from './SettingsTextTemplatesSection'
import { SettingsBackupSection } from './SettingsBackupSection'
import { SettingsConfigSection } from './SettingsConfigSection'
import { SettingsVoiceTriggersSection } from './SettingsVoiceTriggersSection'
import { SettingsDictionarySection } from './SettingsDictionarySection'
import { SettingsArchiveSection } from './SettingsArchiveSection'
import { SettingsProvidersSection } from './SettingsProvidersSection'
import { WebDavSyncView } from './WebDavSyncView'

/**
 * 设置页（布局壳）：主题 / 同步 + 各设置区块。
 * 具体区块各自独立成组件（状态自洽），见同名 Section 组件文件。
 */
export function SettingsView(): React.ReactElement {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h2 className="mb-6 text-2xl font-bold">设置</h2>

      <ThemeSwitcher />

      <WebDavSyncView />

      <div className="mb-8" />

      <SettingsFontScaleSection />

      <SettingsBackupSection />

      <SettingsLockSection />

      <SettingsClassroomBehaviorSection />

      <SettingsConfigSection />

      <SettingsTextTemplatesSection />

      <SettingsVoiceTriggersSection />

      <SettingsDictionarySection />

      <SettingsArchiveSection />

      <SettingsProvidersSection />
    </div>
  )
}
