/**
 * reference-loader — parse failures for malformed candidate files plus the
 * custom-companion merge and tombstone helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  loadReferenceCompanions,
  recordDeletedCandidate,
  clearDeletedCandidate
} from '../../../src/main/companions/reference-loader'
import { CompanionSchema } from '../../../src/shared/schemas/companion'

let candidatesDir = ''
let companionDir = ''

function goodMarkdown(overrides: { gender?: string; age?: string; keywords?: string } = {}): string {
  const gender = overrides.gender ?? '女'
  const age = overrides.age ?? '30 岁'
  const keywords = overrides.keywords ?? '严谨、好奇'
  return [
    '# 测试角色',
    '',
    '## 基本信息',
    '',
    `- **姓名**：测试角色`,
    `- **性别**：${gender}`,
    `- **年龄**：${age}`,
    '- **身份**：导师',
    `- **性格关键词**：${keywords}`,
    '',
    '## 性格详写',
    '',
    '耐心而严谨。',
    '',
    '## 说话风格与示例',
    '',
    '举例说明。',
    '',
    '## 情绪表现',
    '',
    '平静。',
    ''
  ].join('\n')
}

async function writeCandidate(name: string, content: string): Promise<void> {
  await writeFile(join(candidatesDir, `${name}.md`), content, 'utf-8')
}

beforeEach(async () => {
  candidatesDir = await mkdtemp(join(tmpdir(), 'sophia-candidates-'))
  companionDir = await mkdtemp(join(tmpdir(), 'sophia-companions-'))
})

afterEach(async () => {
  await rm(candidatesDir, { recursive: true, force: true })
  await rm(companionDir, { recursive: true, force: true })
})

describe('reference-loader — malformed candidates', () => {
  it.each([
    ['unknown gender', goodMarkdown({ gender: '外星' }), /Unknown gender/],
    ['unparseable age', goodMarkdown({ age: '很大' }), /Could not parse age/],
    ['no keywords', goodMarkdown({ keywords: '，' }), /Could not parse keywords/],
    ['missing name heading', '## 基本信息\n', /Could not extract section/],
    ['missing basic info', '# 角色\n\n## 性格详写\n\n内容\n', /"## 基本信息" not found/],
    [
      'missing field',
      '# 角色\n\n## 基本信息\n\n- **姓名**：角色\n',
      /Field "性别" not found/
    ]
  ])('rejects a candidate with %s', async (_label, markdown, expected) => {
    await writeCandidate('broken', markdown)

    await expect(
      loadReferenceCompanions({ candidatesDir, companionDir })
    ).rejects.toThrow(expected)
  })

  it('rejects a candidate that fails schema validation', async () => {
    // An empty 性格详写 section parses but leaves `personality` empty, which
    // the companion schema forbids.
    const withEmptyPersonality = goodMarkdown().replace(
      '## 性格详写\n\n耐心而严谨。\n\n',
      '## 性格详写\n\n'
    )
    await writeCandidate('nopersonality', withEmptyPersonality)

    await expect(loadReferenceCompanions({ candidatesDir, companionDir })).rejects.toThrow(
      /Schema validation failed/
    )
  })

  it('parses keywords with an elaboration after ——', async () => {
    await writeCandidate('dashed', goodMarkdown({ keywords: '严谨——认真、好奇' }))

    const result = await loadReferenceCompanions({ candidatesDir, companionDir })

    expect(result.companions[0].personalityKeywords).toEqual(['严谨'])
  })
})

describe('reference-loader — merge and tombstones', () => {
  it('keeps custom companions that are not in the candidates directory', async () => {
    await writeCandidate('kept', goodMarkdown())

    // A custom companion already in the index must survive the .md rebuild.
    const custom = CompanionSchema.parse({
      id: 'comp_custom_1',
      source: 'custom',
      version: 1,
      name: '自定义角色',
      gender: 'male',
      age: 30,
      identity: '导师',
      personalityKeywords: ['耐心'],
      personality: 'p',
      speakingStyle: 's',
      emotionalExpressions: 'e',
      originalFile: ''
    })
    await writeFile(
      join(companionDir, 'index.json'),
      JSON.stringify([custom], null, 2),
      'utf-8'
    )

    const result = await loadReferenceCompanions({ candidatesDir, companionDir })

    expect(result.companions.map((c) => c.id)).toContain('comp_kept')
    // The written index keeps both the candidate and the custom companion.
    const written = JSON.parse(
      await readFile(join(companionDir, 'index.json'), 'utf-8')
    ) as Array<{ id: string }>
    expect(written.map((c) => c.id).sort()).toEqual(['comp_custom_1', 'comp_kept'])
  })

  it('records a tombstone once and clears it on restore', async () => {
    await recordDeletedCandidate(companionDir, 'comp_kept')
    await recordDeletedCandidate(companionDir, 'comp_kept') // idempotent

    const tombstonePath = join(companionDir, '.deleted-candidates.json')
    expect(JSON.parse(await readFile(tombstonePath, 'utf-8'))).toEqual(['comp_kept'])

    await clearDeletedCandidate(companionDir, 'comp_kept')
    expect(JSON.parse(await readFile(tombstonePath, 'utf-8'))).toEqual([])

    // Clearing an unknown id leaves the file untouched.
    await clearDeletedCandidate(companionDir, 'comp_unknown')
    expect(JSON.parse(await readFile(tombstonePath, 'utf-8'))).toEqual([])
  })

  it('ignores a tombstone file whose payload is not an array', async () => {
    await writeCandidate('kept', goodMarkdown())
    await writeFile(join(companionDir, '.deleted-candidates.json'), '{"nope":true}', 'utf-8')

    const result = await loadReferenceCompanions({ candidatesDir, companionDir })

    expect(result.companions.map((c) => c.id)).toEqual(['comp_kept'])
  })
})
