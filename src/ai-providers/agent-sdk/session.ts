/**
 * Agent SDK session management — mirrors claude-code/session.ts 7-step flow.
 *
 * 1. appendUser → 2. compactIfNeeded → 3. readActive + toTextHistory
 * 4. build <chat_history> prompt → 5. askAgentSdk → 6. persist messages → 7. return
 */

import type { SessionStore } from '../../core/session.js'
import type { CompactionConfig } from '../../core/compaction.js'
import type { MediaAttachment } from '../../core/types.js'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSdkConfig, AgentSdkOverride } from './query.js'
import { toTextHistory } from '../../core/session.js'
import { compactIfNeeded } from '../../core/compaction.js'
import { extractMediaFromToolResultContent } from '../../core/media.js'
import { askAgentSdk } from './query.js'

// ==================== Types ====================

export interface AgentSdkSessionConfig {
  agentSdk: AgentSdkConfig
  compaction: CompactionConfig
  systemPrompt?: string
  maxHistoryEntries?: number
  historyPreamble?: string
  override?: AgentSdkOverride
  mcpServer?: McpSdkServerConfigWithInstance
}

export interface AgentSdkSessionResult {
  text: string
  media: MediaAttachment[]
}

// ==================== Defaults ====================

const DEFAULT_MAX_HISTORY = 50
const DEFAULT_PREAMBLE =
  'The following is the recent conversation history. Use it as context if it references earlier events or decisions.'

// ==================== Public ====================

export async function askAgentSdkWithSession(
  prompt: string,
  session: SessionStore,
  config: AgentSdkSessionConfig,
): Promise<AgentSdkSessionResult> {
  const maxHistory = config.maxHistoryEntries ?? DEFAULT_MAX_HISTORY
  const preamble = config.historyPreamble ?? DEFAULT_PREAMBLE

  // 1. Append user message to session
  await session.appendUser(prompt, 'human')

  // 2. Compact if needed (using askAgentSdk as summarizer — single turn, no MCP)
  const compactionResult = await compactIfNeeded(
    session,
    config.compaction,
    async (summarizePrompt) => {
      const r = await askAgentSdk(summarizePrompt, {
        ...config.agentSdk,
        maxTurns: 1,
      }, config.override)
      return r.text
    },
  )

  // 3. Read active window and build text history
  const entries = compactionResult.activeEntries ?? await session.readActive()
  const textHistory = toTextHistory(entries).slice(-maxHistory)

  // 4. Build full prompt with <chat_history> if history exists
  let fullPrompt: string
  if (textHistory.length > 0) {
    const lines = textHistory.map((entry) => {
      const tag = entry.role === 'user' ? 'User' : 'Bot'
      return `[${tag}] ${entry.text}`
    })
    fullPrompt = [
      '<chat_history>',
      preamble,
      '',
      ...lines,
      '</chat_history>',
      '',
      prompt,
    ].join('\n')
  } else {
    fullPrompt = prompt
  }

  // 5. Call askAgentSdk — collect media from tool results
  const media: MediaAttachment[] = []
  const result = await askAgentSdk(
    fullPrompt,
    {
      ...config.agentSdk,
      systemPrompt: config.systemPrompt,
      onToolResult: ({ content }) => {
        media.push(...extractMediaFromToolResultContent(content))
      },
    },
    config.override,
    config.mcpServer,
  )

  // 6. Persist intermediate messages (tool calls + results) to session
  for (const msg of result.messages) {
    if (msg.role === 'assistant') {
      await session.appendAssistant(msg.content, 'agent-sdk')
    } else {
      await session.appendUser(msg.content, 'agent-sdk')
    }
  }

  // 7. Return unified result
  const prefix = result.ok ? '' : '[error] '
  return { text: prefix + result.text, media }
}
