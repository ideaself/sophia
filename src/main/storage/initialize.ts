import { mkdir, writeFile } from 'node:fs/promises'
import {
  learnerPath,
  companionDir,
  configDir,
  conversationsDir,
  textbooksDir,
  diaryDir
} from './app-data'
import { loadReferenceCompanions } from '../companions/reference-loader'
import { migrateDataRoot, type DataVersionState } from './data-version'

export interface InitOptions {
  /** Root directory for all local app data */
  dataRoot: string
  /** Directory containing reference candidate character .md files */
  referenceDir: string
}

export interface InitResult {
  companionCount: number
  /** Result of the on-disk data version check/migration. */
  dataVersion: DataVersionState
}

const LEARNER_TEMPLATE = `# 学习者档案

## 基本信息

- **称呼**：（你希望角色怎么叫你？）
- **年级/身份**：
- **当前学习阶段**：

## 学习偏好

- **擅长科目**：
- **困难科目**：
- **学习风格**：（阅读、对话、做题、实验……？）
- **喜欢的教学节奏**：（慢而深 / 快而广 / 跟教材走……）

## 当前目标

（写下来，告诉你的苏格拉底伙伴你想达成什么学习目标。）
`

/**
 * Initialize the local app data directory structure (single user, flat).
 *
 * Creates the directory layout, writes the learner.md template, and
 * learner.md template, and loads/copies all 9 reference companions into the
 * companion pool.
 *
 * Idempotent: if files already exist, they are not overwritten.
 */
export async function initDataDir(options: InitOptions): Promise<InitResult> {
  const { dataRoot, referenceDir } = options

  // --- Create directory structure ---
  await mkdir(configDir(dataRoot), { recursive: true })
  await mkdir(companionDir(dataRoot), { recursive: true })
  await mkdir(conversationsDir(dataRoot), { recursive: true })
  await mkdir(textbooksDir(dataRoot), { recursive: true })
  await mkdir(diaryDir(dataRoot), { recursive: true })

  // --- Bring the data layout up to the current schema generation ---
  const dataVersion = await migrateDataRoot(dataRoot)

  // --- Write learner.md template (only if not exists) ---
  const lnPath = learnerPath(dataRoot)
  try {
    await writeFile(lnPath, LEARNER_TEMPLATE, { flag: 'wx' })
  } catch {
    // File exists — skip
  }

  // --- Load reference companions ---
  const result = await loadReferenceCompanions({
    candidatesDir: referenceDir,
    companionDir: companionDir(dataRoot)
  })

  return {
    companionCount: result.count,
    dataVersion
  }
}
