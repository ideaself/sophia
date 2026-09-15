import { describe, it, expect } from 'vitest'
import {
  CompanionSource,
  CompanionGender,
  MessageRole,
  ArtifactType
} from '../../src/shared/types/ids'
import type {
  CompanionId,
  TextbookId,
  ConversationId,
  MessageId,
  ArtifactId
} from '../../src/shared/types/ids'

// --- Schema imports ---
import { CompanionSchema, type Companion } from '../../src/shared/schemas/companion'
import { TextbookSchema, type Textbook } from '../../src/shared/schemas/textbook'
import { ConversationSchema, type Conversation } from '../../src/shared/schemas/conversation'
import { MessageSchema, type Message } from '../../src/shared/schemas/message'
import { ArtifactSchema, type Artifact } from '../../src/shared/schemas/artifact'
import {
  EntityIdSchema,
  IpcCreateConversationInputSchema,
  IpcSendMessageInputSchema,
  IpcUpdateMessageInputSchema,
  IpcEndClassInputSchema,
  IpcRedoArtifactsInputSchema,
  IpcTruncateConversationInputSchema,
  IpcChatPromptMessagesInputSchema,
  IpcTextbookSearchExcerptInputSchema,
  IpcTextbookTranslateExcerptInputSchema,
  IpcExportBackupInputSchema,
  IpcRestoreBackupInputSchema,
  IpcConceptsListInputSchema,
  IpcFlashcardSrsStateInputSchema,
  IpcFlashcardFavoritesInputSchema,
  IpcGetConversationInputSchema,
  IpcGetMessagesInputSchema,
  IpcGetArtifactInputSchema,
  IpcUpdateArtifactInputSchema,
  IpcListArtifactsInputSchema,
  IpcDeleteConversationInputSchema,
  IpcSearchMessagesInputSchema,
  IpcGetTextbookInputSchema,
  IpcDeleteReadingNoteInputSchema,
  IpcProviderCreateInputSchema,
  IpcProviderUpdateInputSchema,
  IpcProviderSetApiKeyInputSchema,
  ProviderBaseUrlSchema
} from '../../src/shared/schemas/ipc'

// ============================================================
// Helper: build valid objects for each domain type
// ============================================================

function validCompanion(): Companion {
  return {
    id: 'comp_alice01' as CompanionId,
    source: CompanionSource.Candidate,
    version: 1,
    name: 'Alice',
    gender: CompanionGender.Female,
    age: 15,
    identity: '化工系本科一年级，少年大学生',
    personalityKeywords: ['好奇', '直觉'],
    personality: '十五岁天才少年...',
    speakingStyle: '语速快，思维跳跃',
    emotionalExpressions: '开心时笑得灿烂',
    originalFile: 'reference/角色设定/candidates/alice.md'
  }
}

function validTextbook(): Textbook {
  return {
    id: 'tb_001' as TextbookId,
    title: 'Introduction to Chemistry',
    author: '',
    description: '',
    format: 'markdown',
    sourceFile: '/path/to/chem.md',
    originalFile: '',
    content: '# Chemistry\n\nAtoms and molecules...',
    fileHash: '',
    progress: { currentPage: 1, totalPages: null, readingPercentage: 0, lastPosition: '' },
    rating: 0,
    isDeleted: false,
    createdAt: '2026-07-06T12:00:00.000Z',
    updatedAt: '2026-07-06T12:00:00.000Z'
  }
}

function validConversation(): Conversation {
  return {
    id: 'conv_001' as ConversationId,
    companionId: 'comp_alice01' as CompanionId,
    companionVersion: 3,
    textbookId: 'tb_001' as TextbookId,
    title: 'Chemistry with Alice',
    createdAt: '2026-07-06T12:00:00.000Z',
    updatedAt: '2026-07-06T12:00:00.000Z',
    endedAt: null
  }
}

function validMessage(): Message {
  return {
    id: 'msg_001' as MessageId,
    conversationId: 'conv_001' as ConversationId,
    role: 'user',
    content: 'What is an atom?',
    createdAt: '2026-07-06T12:00:01.000Z'
  }
}

function validArtifact(): Artifact {
  return {
    id: 'art_001' as ArtifactId,
    conversationId: 'conv_001' as ConversationId,
    type: 'lesson_summary',
    content: '# Summary\n\nToday we covered atoms...',
    createdAt: '2026-07-06T12:30:00.000Z'
  }
}

// ============================================================
// Companion Schema Tests
// ============================================================
describe('CompanionSchema', () => {
  it('accepts a valid companion', () => {
    const result = CompanionSchema.safeParse(validCompanion())
    expect(result.success).toBe(true)
  })

  it('rejects a companion with invalid source', () => {
    const result = CompanionSchema.safeParse({ ...validCompanion(), source: 'alien' })
    expect(result.success).toBe(false)
  })

  it('rejects a companion with invalid gender', () => {
    const result = CompanionSchema.safeParse({ ...validCompanion(), gender: 'robot' })
    expect(result.success).toBe(false)
  })

  it('rejects a companion with negative age', () => {
    const result = CompanionSchema.safeParse({ ...validCompanion(), age: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects a companion with empty personalityKeywords array', () => {
    const result = CompanionSchema.safeParse({ ...validCompanion(), personalityKeywords: [] })
    expect(result.success).toBe(false)
  })

  it('rejects a companion missing required fields', () => {
    const result = CompanionSchema.safeParse({ id: 'comp_x' })
    expect(result.success).toBe(false)
  })

  it('accepts a companion with Custom source', () => {
    const result = CompanionSchema.safeParse({
      ...validCompanion(),
      source: CompanionSource.Custom,
      originalFile: ''
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================
// Textbook Schema Tests
// ============================================================
describe('TextbookSchema', () => {
  it('accepts a valid textbook', () => {
    const result = TextbookSchema.safeParse(validTextbook())
    expect(result.success).toBe(true)
  })

  it('rejects a textbook with unsupported format', () => {
    const result = TextbookSchema.safeParse({ ...validTextbook(), format: 'docx' })
    expect(result.success).toBe(false)
  })

  it('rejects a textbook with negative currentPage', () => {
    const result = TextbookSchema.safeParse({
      ...validTextbook(),
      progress: { currentPage: -1, totalPages: 10 }
    })
    expect(result.success).toBe(false)
  })

  it('accepts a textbook with null totalPages (unknown length)', () => {
    const result = TextbookSchema.safeParse({
      ...validTextbook(),
      progress: { currentPage: 1, totalPages: null }
    })
    expect(result.success).toBe(true)
  })

  it('accepts a pasted textbook (empty sourceFile)', () => {
    const result = TextbookSchema.safeParse({ ...validTextbook(), sourceFile: '' })
    expect(result.success).toBe(true)
  })

  it('accepts a textbook with empty content (defaults to "")', () => {
    const result = TextbookSchema.safeParse({ ...validTextbook(), content: '' })
    expect(result.success).toBe(true)
    expect(result.data?.content).toBe('')
  })

  it('companion version defaults to 1 for legacy records', () => {
    const { version, ...legacy } = validCompanion()
    const result = CompanionSchema.safeParse(legacy)
    expect(result.success).toBe(true)
    expect(result.data?.version).toBe(1)
  })

  it('conversation companionVersion defaults to null for legacy records', () => {
    const { companionVersion, ...legacy } = validConversation()
    const result = ConversationSchema.safeParse(legacy)
    expect(result.success).toBe(true)
    expect(result.data?.companionVersion).toBeNull()
  })
})

// ============================================================
// Conversation Schema Tests
// ============================================================
describe('ConversationSchema', () => {
  it('accepts a valid conversation', () => {
    const result = ConversationSchema.safeParse(validConversation())
    expect(result.success).toBe(true)
  })

  it('accepts a conversation with null textbookId', () => {
    const result = ConversationSchema.safeParse({ ...validConversation(), textbookId: null })
    expect(result.success).toBe(true)
  })

  it('rejects a conversation with empty title', () => {
    const result = ConversationSchema.safeParse({ ...validConversation(), title: '' })
    expect(result.success).toBe(false)
  })

})

// ============================================================
// Message Schema Tests
// ============================================================
describe('MessageSchema', () => {
  it('accepts a valid user message', () => {
    const result = MessageSchema.safeParse(validMessage())
    expect(result.success).toBe(true)
  })

  it('accepts an assistant message', () => {
    const result = MessageSchema.safeParse({
      ...validMessage(),
      role: MessageRole.Assistant,
      content: 'That is a great question! Let me think...'
    })
    expect(result.success).toBe(true)
  })

  it('accepts a system message', () => {
    const result = MessageSchema.safeParse({
      ...validMessage(),
      role: MessageRole.System,
      content: 'Class started.'
    })
    expect(result.success).toBe(true)
  })

  it('rejects a message with invalid role', () => {
    const result = MessageSchema.safeParse({ ...validMessage(), role: 'bot' })
    expect(result.success).toBe(false)
  })

  it('rejects a message with empty content', () => {
    const result = MessageSchema.safeParse({ ...validMessage(), content: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a message with whitespace-only content', () => {
    const result = MessageSchema.safeParse({ ...validMessage(), content: '   \n  ' })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// Artifact Schema Tests
// ============================================================
describe('ArtifactSchema', () => {
  it('accepts a valid lesson summary artifact', () => {
    const result = ArtifactSchema.safeParse(validArtifact())
    expect(result.success).toBe(true)
  })

  it('accepts a flashcards artifact', () => {
    const result = ArtifactSchema.safeParse({
      ...validArtifact(),
      type: ArtifactType.Flashcards,
      content: JSON.stringify([{ q: 'Q1', a: 'A1' }])
    })
    expect(result.success).toBe(true)
  })

  it('accepts a diary artifact', () => {
    const result = ArtifactSchema.safeParse({
      ...validArtifact(),
      type: ArtifactType.Diary,
      content: '## 2026-07-06\n\nToday was great...'
    })
    expect(result.success).toBe(true)
  })

  it('accepts a progress artifact', () => {
    const result = ArtifactSchema.safeParse({
      ...validArtifact(),
      type: ArtifactType.Progress,
      content: 'Current page: 42'
    })
    expect(result.success).toBe(true)
  })

  it('accepts a handoff_tail artifact', () => {
    const result = ArtifactSchema.safeParse({
      ...validArtifact(),
      type: ArtifactType.HandoffTail,
      content: JSON.stringify({ savedAt: '2026-07-06T12:00:00Z', messages: [] })
    })
    expect(result.success).toBe(true)
  })

  it('accepts a feynman_note artifact', () => {
    const result = ArtifactSchema.safeParse({
      ...validArtifact(),
      type: ArtifactType.FeynmanNote,
      content: '## 学习者讲解了什么\n学习者解释了不确定性原理。'
    })
    expect(result.success).toBe(true)
  })

  it('accepts every ArtifactType value (no type may be dropped on read)', () => {
    for (const type of Object.values(ArtifactType)) {
      const result = ArtifactSchema.safeParse({ ...validArtifact(), type })
      expect(result.success, `ArtifactSchema rejected ${type}`).toBe(true)
    }
  })

  it('rejects an artifact with invalid type', () => {
    const result = ArtifactSchema.safeParse({ ...validArtifact(), type: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('rejects an artifact with empty content', () => {
    const result = ArtifactSchema.safeParse({ ...validArtifact(), content: '' })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// IPC Input Schema Tests
// ============================================================
describe('IPC input schemas', () => {


  describe('IpcCreateConversationInputSchema', () => {
    it('accepts valid input with textbook', () => {
      const result = IpcCreateConversationInputSchema.safeParse({
            companionId: 'comp_alice01',
        textbookId: 'tb_001',
        title: 'Chemistry Session'
      })
      expect(result.success).toBe(true)
    })

    it('accepts valid input without textbook', () => {
      const result = IpcCreateConversationInputSchema.safeParse({
            companionId: 'comp_alice01',
        title: 'Free Chat'
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty title', () => {
      const result = IpcCreateConversationInputSchema.safeParse({
            companionId: 'comp_alice01',
        title: ''
      })
      expect(result.success).toBe(false)
    })
  })

  describe('IpcSendMessageInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcSendMessageInputSchema.safeParse({
        conversationId: 'conv_001',
        content: 'What is quantum mechanics?'
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty content', () => {
      const result = IpcSendMessageInputSchema.safeParse({
        conversationId: 'conv_001',
        content: ''
      })
      expect(result.success).toBe(false)
    })
  })

  describe('IpcEndClassInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcEndClassInputSchema.safeParse({ conversationId: 'conv_001' })
      expect(result.success).toBe(true)
    })

    it('accepts classMode', () => {
      const result = IpcEndClassInputSchema.safeParse({
        conversationId: 'conv_001',
        classMode: 'feynman'
      })
      expect(result.success).toBe(true)
    })

    it('rejects unknown classMode', () => {
      const result = IpcEndClassInputSchema.safeParse({
        conversationId: 'conv_001',
        classMode: 'pet'
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing conversationId', () => {
      const result = IpcEndClassInputSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe('IpcChatPromptMessagesInputSchema', () => {
    const base = {
      conversationId: 'conv_001',
      companionId: 'comp_001',
      userMessage: '你好'
    }

    it('accepts classMode feynman', () => {
      const result = IpcChatPromptMessagesInputSchema.safeParse({
        ...base,
        classMode: 'feynman'
      })
      expect(result.success).toBe(true)
    })

    it('accepts pace slow/fast', () => {
      for (const pace of ['slow', 'normal', 'fast']) {
        const result = IpcChatPromptMessagesInputSchema.safeParse({ ...base, pace })
        expect(result.success).toBe(true)
      }
    })

    it('accepts input without classMode', () => {
      const result = IpcChatPromptMessagesInputSchema.safeParse(base)
      expect(result.success).toBe(true)
    })
  })

  describe('IpcRedoArtifactsInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcRedoArtifactsInputSchema.safeParse({
        conversationId: 'conv_001',
        types: ['lesson_summary', 'diary']
      })
      expect(result.success).toBe(true)
    })

    it('rejects an empty types list', () => {
      const result = IpcRedoArtifactsInputSchema.safeParse({
        conversationId: 'conv_001',
        types: []
      })
      expect(result.success).toBe(false)
    })
  })

  describe('IpcTruncateConversationInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcTruncateConversationInputSchema.safeParse({
        conversationId: 'conv_001',
        messageId: 'msg_001'
      })
      expect(result.success).toBe(true)
    })

    it('rejects a missing messageId', () => {
      const result = IpcTruncateConversationInputSchema.safeParse({
        conversationId: 'conv_001'
      })
      expect(result.success).toBe(false)
    })
  })

  describe('IpcTextbookSearchExcerptInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcTextbookSearchExcerptInputSchema.safeParse({
        textbookId: 'tb_001',
        chapter: '第二章 不确定性原理'
      })
      expect(result.success).toBe(true)
    })

    it('rejects an empty chapter', () => {
      const result = IpcTextbookSearchExcerptInputSchema.safeParse({
        textbookId: 'tb_001',
        chapter: ''
      })
      expect(result.success).toBe(false)
    })
  })

  describe('IpcTextbookTranslateExcerptInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcTextbookTranslateExcerptInputSchema.safeParse({
        textbookId: 'tb_001',
        chapter: '第二章 不确定性原理'
      })
      expect(result.success).toBe(true)
    })

    it('rejects a missing chapter', () => {
      const result = IpcTextbookTranslateExcerptInputSchema.safeParse({
        textbookId: 'tb_001'
      })
      expect(result.success).toBe(false)
    })
  })

  describe('IpcExportBackupInputSchema', () => {
    it('accepts a file path', () => {
      const result = IpcExportBackupInputSchema.safeParse({
        filePath: 'C:\\backup\\data.zip'
      })
      expect(result.success).toBe(true)
    })

    it('rejects an empty file path', () => {
      const result = IpcExportBackupInputSchema.safeParse({ filePath: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('IpcGetConversationInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcGetConversationInputSchema.safeParse({ conversationId: 'conv_001' })
      expect(result.success).toBe(true)
    })
  })


  describe('IpcGetMessagesInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcGetMessagesInputSchema.safeParse({ conversationId: 'conv_001' })
      expect(result.success).toBe(true)
    })
  })

  describe('IpcGetArtifactInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcGetArtifactInputSchema.safeParse({ artifactId: 'art_001', conversationId: 'conv_001' })
      expect(result.success).toBe(true)
    })
  })

  describe('IpcUpdateArtifactInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcUpdateArtifactInputSchema.safeParse({
        artifactId: 'art_001',
        conversationId: 'conv_001',
        content: '修正后的内容'
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty content', () => {
      const result = IpcUpdateArtifactInputSchema.safeParse({
        artifactId: 'art_001',
        conversationId: 'conv_001',
        content: ''
      })
      expect(result.success).toBe(false)
    })
  })

  describe('IpcListArtifactsInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcListArtifactsInputSchema.safeParse({ conversationId: 'conv_001' })
      expect(result.success).toBe(true)
    })
  })

  describe('IpcDeleteConversationInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcDeleteConversationInputSchema.safeParse({ conversationId: 'conv_001' })
      expect(result.success).toBe(true)
    })
  })

  describe('IpcSearchMessagesInputSchema', () => {
    it('accepts valid input', () => {
      const result = IpcSearchMessagesInputSchema.safeParse({
            query: 'atom'
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty query', () => {
      const result = IpcSearchMessagesInputSchema.safeParse({
            query: ''
      })
      expect(result.success).toBe(false)
    })

    it('rejects query shorter than 2 characters', () => {
      const result = IpcSearchMessagesInputSchema.safeParse({
            query: 'a'
      })
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================
// Entity ID Schema Tests
// ============================================================

describe('EntityIdSchema', () => {
  it('accepts realistic domain ids', () => {
    for (const id of ['conv_1720000000000_1', 'msg_abc-XYZ_9', 'comp_alice', 'tb_001', 'art_1', 'rn_2']) {
      expect(EntityIdSchema.safeParse(id).success, id).toBe(true)
    }
  })

  it('rejects path traversal and separators', () => {
    for (const id of ['../config', '..\\config', 'a/b', 'a\\b', '..', '.', 'a b', 'a.b', '爱丽丝']) {
      expect(EntityIdSchema.safeParse(id).success, id).toBe(false)
    }
  })

  it('rejects empty and overlong ids', () => {
    expect(EntityIdSchema.safeParse('').success).toBe(false)
    expect(EntityIdSchema.safeParse('a'.repeat(129)).success).toBe(false)
  })

  it('is enforced on traversal-capable IPC inputs', () => {
    expect(IpcDeleteConversationInputSchema.safeParse({ conversationId: '../../config' }).success).toBe(false)
    expect(IpcGetArtifactInputSchema.safeParse({ artifactId: '..\\x', conversationId: 'conv_1' }).success).toBe(false)
    expect(IpcGetTextbookInputSchema.safeParse({ textbookId: '../..' }).success).toBe(false)
    expect(IpcDeleteReadingNoteInputSchema.safeParse({ noteId: 'x', textbookId: '../x' }).success).toBe(false)
  })
})

// ============================================================
// Provider IPC Schema Tests
// ============================================================

describe('Provider IPC schemas', () => {
  function validProviderCreate() {
    return {
      name: 'DeepSeek',
      type: 'deepseek' as const,
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test'
    }
  }

  it('accepts a valid provider create payload', () => {
    expect(IpcProviderCreateInputSchema.safeParse(validProviderCreate()).success).toBe(true)
  })

  it('allows creating a provider without an API key (key can be added later)', () => {
    const result = IpcProviderCreateInputSchema.safeParse({ ...validProviderCreate(), apiKey: '' })
    expect(result.success).toBe(true)
  })

  it('rejects a plain http:// base URL', () => {
    const result = IpcProviderCreateInputSchema.safeParse({
      ...validProviderCreate(),
      baseUrl: 'http://api.deepseek.com'
    })
    expect(result.success).toBe(false)
  })

  it('rejects mixed-case HTTP:// base URLs (case-insensitive scheme)', () => {
    for (const baseUrl of ['HTTP://evil.example', 'HtTp://evil.example', 'hTTp://evil.example']) {
      const result = IpcProviderCreateInputSchema.safeParse({ ...validProviderCreate(), baseUrl })
      expect(result.success, `${baseUrl} must be rejected`).toBe(false)
    }
  })

  it('rejects non-https protocols and malformed URLs', () => {
    for (const baseUrl of ['ftp://example.com', 'ws://example.com', 'not-a-url', '']) {
      expect(ProviderBaseUrlSchema.safeParse(baseUrl).success, `${baseUrl} must be rejected`).toBe(false)
    }
  })

  it('validates base URL updates too', () => {
    const result = IpcProviderUpdateInputSchema.safeParse({
      id: 'prov_1',
      baseUrl: 'http://api.example.com'
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty API keys', () => {
    const result = IpcProviderSetApiKeyInputSchema.safeParse({ id: 'prov_1', apiKey: '' })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// Write-boundary schemas (message trim, restore, concepts, SRS)
// ============================================================

describe('write-boundary schemas', () => {
  it('rejects whitespace-only messages on send and update', () => {
    const send = IpcSendMessageInputSchema.safeParse({
      conversationId: 'conv_1',
      content: '   \n  '
    })
    expect(send.success).toBe(false)

    const update = IpcUpdateMessageInputSchema.safeParse({
      conversationId: 'conv_1',
      messageId: 'msg_1',
      content: '   '
    })
    expect(update.success).toBe(false)
  })

  it('trims message content on the way in', () => {
    const result = IpcSendMessageInputSchema.safeParse({
      conversationId: 'conv_1',
      content: '  hi  '
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.content).toBe('hi')
  })

  it('validates the restore-backup path argument', () => {
    expect(IpcRestoreBackupInputSchema.safeParse('C:\\backups\\a.zip').success).toBe(true)
    expect(IpcRestoreBackupInputSchema.safeParse('').success).toBe(false)
    expect(IpcRestoreBackupInputSchema.safeParse(123).success).toBe(false)
  })

  it('accepts a conversation id or empty string for concepts:list', () => {
    expect(IpcConceptsListInputSchema.safeParse('conv_1').success).toBe(true)
    expect(IpcConceptsListInputSchema.safeParse('').success).toBe(true)
    expect(IpcConceptsListInputSchema.safeParse('../x').success).toBe(false)
  })

  it('caps flashcard SRS state shape and size', () => {
    expect(IpcFlashcardSrsStateInputSchema.safeParse({ k1: { due: 1 } }).success).toBe(true)
    expect(IpcFlashcardSrsStateInputSchema.safeParse(['not', 'a', 'map']).success).toBe(false)
    // > 2 MB payload is rejected
    const huge: Record<string, string> = { k: 'x'.repeat(3 * 1024 * 1024) }
    expect(IpcFlashcardSrsStateInputSchema.safeParse(huge).success).toBe(false)
  })

  it('caps favorites: bounded keys and count', () => {
    expect(IpcFlashcardFavoritesInputSchema.safeParse(['conv_1::art_1::0']).success).toBe(true)
    expect(IpcFlashcardFavoritesInputSchema.safeParse([123]).success).toBe(false)
    expect(IpcFlashcardFavoritesInputSchema.safeParse(['x'.repeat(600)]).success).toBe(false)
  })
})
