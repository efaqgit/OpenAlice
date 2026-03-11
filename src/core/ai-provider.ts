/**
 * AIProvider — unified abstraction over AI backends.
 *
 * Each provider (Vercel AI SDK, Claude Code CLI, …) implements this interface
 * with its own session management flow.  ProviderRouter reads the runtime
 * config and delegates to the correct implementation.
 */

import type { SessionStore } from './session.js'
import type { MediaAttachment } from './types.js'
import { readAIProviderConfig } from './config.js'

// ==================== Types ====================

export interface AskOptions {
  /**
   * Preamble text describing the conversation context.
   * Claude Code: injected inside the `<chat_history>` text block.
   * Vercel AI SDK: not used (native ModelMessage[] carries the history directly).
   */
  historyPreamble?: string
  /**
   * System prompt override for this call.
   * Claude Code: passed as `--system-prompt` to the CLI.
   * Vercel AI SDK: replaces the agent's `instructions` for this call (triggers agent re-creation if changed).
   */
  systemPrompt?: string
  /**
   * Max text history entries to include in context.
   * Claude Code: limits entries in the `<chat_history>` block. Default: 50.
   * Vercel AI SDK: not used (compaction via `compactIfNeeded` controls context size).
   */
  maxHistoryEntries?: number
  /**
   * Tool names to disable for this call, in addition to the global disabled list.
   * Claude Code: merged into `disallowedTools` CLI option.
   * Vercel AI SDK: filtered out from the tool map before the agent is created.
   */
  disabledTools?: string[]
  /**
   * AI provider to use for this call, overriding the global ai-provider.json config.
   * Falls back to global config if not specified.
   */
  provider?: 'claude-code' | 'vercel-ai-sdk' | 'agent-sdk'
  /**
   * Vercel AI SDK model override — per-request provider/model/baseUrl/apiKey.
   * Only used when the active backend is 'vercel-ai-sdk'.
   */
  vercelAiSdk?: {
    provider: string
    model: string
    baseUrl?: string
    apiKey?: string
  }
  /**
   * Agent SDK model override — per-request model/apiKey/baseUrl.
   * Only used when the active backend is 'agent-sdk'.
   */
  agentSdk?: {
    model?: string
    apiKey?: string
    baseUrl?: string
  }
}

export interface ProviderResult {
  text: string
  media: MediaAttachment[]
}

/** Unified AI provider — each backend implements its own session handling. */
export interface AIProvider {
  /** Stateless prompt — no session context. */
  ask(prompt: string): Promise<ProviderResult>
  /** Prompt with session history and compaction. */
  askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<ProviderResult>
}

// ==================== Router ====================

/** Reads runtime AI config and delegates to the correct provider. */
export class ProviderRouter implements AIProvider {
  constructor(
    private vercel: AIProvider,
    private claudeCode: AIProvider | null,
    private agentSdk: AIProvider | null = null,
  ) {}

  async ask(prompt: string): Promise<ProviderResult> {
    const config = await readAIProviderConfig()
    if (config.backend === 'agent-sdk' && this.agentSdk) {
      return this.agentSdk.ask(prompt)
    }
    if (config.backend === 'claude-code' && this.claudeCode) {
      return this.claudeCode.ask(prompt)
    }
    return this.vercel.ask(prompt)
  }

  async askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<ProviderResult> {
    // Per-request provider override takes precedence over global config
    if (opts?.provider === 'agent-sdk' && this.agentSdk) {
      return this.agentSdk.askWithSession(prompt, session, opts)
    }
    if (opts?.provider === 'claude-code' && this.claudeCode) {
      return this.claudeCode.askWithSession(prompt, session, opts)
    }
    if (opts?.provider === 'vercel-ai-sdk') {
      return this.vercel.askWithSession(prompt, session, opts)
    }
    // Fall back to global config
    const config = await readAIProviderConfig()
    if (config.backend === 'agent-sdk' && this.agentSdk) {
      return this.agentSdk.askWithSession(prompt, session, opts)
    }
    if (config.backend === 'claude-code' && this.claudeCode) {
      return this.claudeCode.askWithSession(prompt, session, opts)
    }
    return this.vercel.askWithSession(prompt, session, opts)
  }
}
