import { z } from 'zod'
import type { CompanionId } from '../types/ids'
import { CompanionSource, CompanionGender } from '../types/ids'

export interface Companion {
  id: CompanionId
  source: z.infer<typeof companionSourceSchema>
  /** 人格版本（里程碑 2）：每次编辑 +1，会话创建时快照记录。 */
  version: number
  name: string
  gender: z.infer<typeof companionGenderSchema>
  age: number
  identity: string
  personalityKeywords: string[]
  personality: string
  speakingStyle: string
  emotionalExpressions: string
  originalFile: string
}

const companionSourceSchema = z.enum([
  CompanionSource.Candidate,
  CompanionSource.Custom
])

const companionGenderSchema = z.enum([
  CompanionGender.Male,
  CompanionGender.Female,
  CompanionGender.Other
])

export const CompanionSchema = z.object({
  id: z.string().min(1),
  source: companionSourceSchema,
  /** 缺失时默认 1（兼容旧数据，隐式迁移）。 */
  version: z.number().int().min(1).default(1),
  name: z.string().min(1),
  gender: companionGenderSchema,
  age: z.number().int().min(0),
  identity: z.string().min(1),
  personalityKeywords: z.array(z.string().min(1)).min(1),
  personality: z.string().min(1),
  speakingStyle: z.string(),
  emotionalExpressions: z.string(),
  originalFile: z.string()
})
