import { ipcMain } from 'electron'
import { readFile, access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { CompanionSchema } from '../../shared/schemas/companion'
import type { z } from 'zod'
import { companionDir } from '../storage/app-data'
import { archiveCompanion } from '../storage/archive-store'
import { atomicWriteFile } from '../storage/atomic-write'

type CompanionData = z.infer<typeof CompanionSchema>

async function readIndex(dataRoot: string): Promise<CompanionData[]> {
  const indexPath = join(companionDir(dataRoot), 'index.json')
  try {
    await access(indexPath)
    const content = await readFile(indexPath, 'utf-8')
    return CompanionSchema.array().parse(JSON.parse(content))
  } catch {
    return []
  }
}

async function writeIndex(dataRoot: string, companions: CompanionData[]) {
  const dir = companionDir(dataRoot)
  await mkdir(dir, { recursive: true })
  await atomicWriteFile(join(dir, 'index.json'), JSON.stringify(companions, null, 2), 'utf-8')
}

export function registerCompanionIpc(dataRoot: string): void {
  ipcMain.handle('companion:list', async () => {
    return readIndex(dataRoot)
  })

  ipcMain.handle('companion:get', async (_event, input: unknown) => {
    const { companionId } = input as { companionId: string }
    const companions = await readIndex(dataRoot)
    return companions.find((c) => c.id === companionId) ?? null
  })

  ipcMain.handle('companion:create', async (_event, input: unknown) => {
    const {
      name, gender, age, identity, personalityKeywords,
      personality, speakingStyle, emotionalExpressions
    } = input as {
      name: string
      gender: string
      age: number
      identity: string
      personalityKeywords: string[]
      personality: string
      speakingStyle: string
      emotionalExpressions: string
    }

    const companions = await readIndex(dataRoot)
    const newCompanion = CompanionSchema.parse({
      id: `custom_${Date.now()}`,
      source: 'custom',
      name,
      gender,
      age,
      identity,
      personalityKeywords,
      personality,
      speakingStyle,
      emotionalExpressions,
      originalFile: ''
    })
    companions.push(newCompanion)
    await writeIndex(dataRoot, companions)
    return newCompanion
  })

  ipcMain.handle('companion:update', async (_event, input: unknown) => {
    const { companionId, ...updates } = input as { companionId: string; [key: string]: unknown }
    const companions = await readIndex(dataRoot)
    const idx = companions.findIndex((c) => c.id === companionId)
    if (idx === -1) return null
    const parsed = CompanionSchema.parse({ ...companions[idx], ...updates, id: companionId })
    companions[idx] = parsed
    await writeIndex(dataRoot, companions)
    return parsed
  })

  ipcMain.handle('companion:delete', async (_event, input: unknown) => {
    const { companionId } = input as { companionId: string }
    const companions = await readIndex(dataRoot)
    const target = companions.find((c) => c.id === companionId)
    const filtered = companions.filter((c) => c.id !== companionId)
    if (filtered.length === companions.length) return false
    // Archive the companion record before removing it (4.0.1).
    if (target) {
      try {
        await archiveCompanion(dataRoot, companionId, target.name || companionId, target)
      } catch (err) {
        console.warn(`Archive companion ${companionId} failed:`, err)
      }
    }
    await writeIndex(dataRoot, filtered)
    return true
  })
}
