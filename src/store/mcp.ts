import { create } from 'zustand'
import type { McpServer, McpTool, McpToolName } from '../types'
import { mcpAction, mcpList, mcpSave, type McpServerInput } from '../lib/daemon'

interface McpState {
  servers: McpServer[]
  loaded: boolean
  loading: boolean
  error: string
  load: () => Promise<void>
  save: (servers: McpServerInput[]) => Promise<void>
  act: (id: string, action: 'connect' | 'disconnect' | 'refresh') => Promise<void>
  lookup: (fn: string) => { server: McpServer; tool: McpTool } | null
}

let pollTimer: number | undefined

export const useMcp = create<McpState>()((set, get) => {
  const apply = (servers: McpServer[]) => {
    set({ servers, loaded: true, loading: false, error: '' })
    if (pollTimer !== undefined) window.clearTimeout(pollTimer)
    pollTimer = undefined
    // Servers that are still starting (npx may download packages) are polled until they settle.
    if (servers.some((server) => server.status === 'connecting')) {
      pollTimer = window.setTimeout(() => void get().load(), 1200)
    }
  }
  return {
    servers: [],
    loaded: false,
    loading: false,
    error: '',
    load: async () => {
      set({ loading: true })
      try {
        apply((await mcpList()).servers)
      } catch (error) {
        set({ loading: false, loaded: true, error: error instanceof Error ? error.message : 'Could not load MCP servers.' })
      }
    },
    save: async (servers) => {
      const result = await mcpSave(servers)
      apply(result.servers)
    },
    act: async (id, action) => {
      // Show "connecting" at once; the daemon answers when the handshake finishes.
      if (action !== 'disconnect') {
        set((state) => ({
          servers: state.servers.map((server) => (server.id === id ? { ...server, status: 'connecting', error: '' } : server)),
        }))
      }
      const result = await mcpAction(id, action)
      apply(result.servers)
    },
    lookup: (fn) => {
      for (const server of get().servers) {
        const tool = server.tools.find((entry) => entry.fn === fn)
        if (tool) return { server, tool }
      }
      return null
    },
  }
})

export function isMcpToolName(name: string): name is McpToolName {
  return name.startsWith('mcp__')
}
