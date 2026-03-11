/**
 * AgentSdkProvider — AIProvider backed by @anthropic-ai/claude-agent-sdk.
 *
 * Thin adapter: delegates to askAgentSdkWithSession which owns the full
 * session management flow (append → compact → build <chat_history> → query → persist).
 *
 * Reuses agent.json's `claudeCode` config block (allowedTools, disallowedTools, maxTurns)
 * since both providers are backed by the same Claude Code CLI.
 */

import { resolve } from 'node:path'
import type { Tool } from 'ai'
import type { AIProvider, AskOptions, ProviderResult } from '../../core/ai-provider.js'
import type { SessionStore } from '../../core/session.js'
import type { CompactionConfig } from '../../core/compaction.js'
import type { AgentSdkConfig, AgentSdkOverride } from './query.js'
import { readAgentConfig } from '../../core/config.js'
import { askAgentSdk } from './query.js'
import { askAgentSdkWithSession } from './session.js'
import { buildAgentSdkMcpServer } from './tool-bridge.js'

export class AgentSdkProvider implements AIProvider {
  constructor(
    private getTools: () => Promise<Record<string, Tool>>,
    private compaction: CompactionConfig,
    private systemPrompt?: string,
  ) {}

  /** Re-read agent config from disk to pick up hot-reloaded settings. */
  private async resolveConfig(): Promise<AgentSdkConfig> {
    const agent = await readAgentConfig()
    return {
      ...agent.claudeCode,
      evolutionMode: agent.evolutionMode,
      cwd: agent.evolutionMode ? process.cwd() : resolve('data/brain'),
    }
  }

  /** Build an in-process MCP server from ToolCenter, filtering disabled tools. */
  private async buildMcpServer(disabledTools?: string[]) {
    const tools = await this.getTools()
    return buildAgentSdkMcpServer(tools, disabledTools)
  }

  async ask(prompt: string): Promise<ProviderResult> {
    const config = await this.resolveConfig()
    const mcpServer = await this.buildMcpServer()
    const result = await askAgentSdk(prompt, config, undefined, mcpServer)
    return { text: result.text, media: [] }
  }

  async askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<ProviderResult> {
    const config = await this.resolveConfig()

    // Merge per-channel disabledTools with global disallowedTools
    const agentSdk: AgentSdkConfig = opts?.disabledTools?.length
      ? { ...config, disallowedTools: [...(config.disallowedTools ?? []), ...opts.disabledTools] }
      : config

    // Per-channel override (model/apiKey/baseUrl)
    const override: AgentSdkOverride | undefined = opts?.agentSdk

    const mcpServer = await this.buildMcpServer(opts?.disabledTools)

    return askAgentSdkWithSession(prompt, session, {
      agentSdk,
      compaction: this.compaction,
      historyPreamble: opts?.historyPreamble,
      systemPrompt: opts?.systemPrompt ?? this.systemPrompt,
      maxHistoryEntries: opts?.maxHistoryEntries,
      override,
      mcpServer,
    })
  }
}
