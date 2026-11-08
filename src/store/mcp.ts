import { create } from 'zustand'
import type { McpServer, McpTool, McpToolName } from '../types'
<<<<<<< HEAD
import { mcpAction, mcpAuthorize, mcpList, mcpLogout, mcpSave, type McpServerInput } from '../lib/daemon'
=======
import { mcpAction, mcpList, mcpSave, type McpServerInput } from '../lib/daemon'
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333

interface McpState {
  servers: McpServer[]
  loaded: boolean
  loading: boolean
  error: string
  load: () => Promise<void>
  save: (servers: McpServerInput[]) => Promise<void>
  act: (id: string, action: 'connect' | 'disconnect' | 'refresh') => Promise<void>
<<<<<<< HEAD
  /** Opens the provider's consent page; resolves once the popup was opened. */
  authorize: (id: string) => Promise<void>
  logout: (id: string) => Promise<void>
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
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
<<<<<<< HEAD
    authorize: async (id) => {
      const { url } = await mcpAuthorize(id)
      const popup = window.open(url, 'opensol-mcp-oauth', 'popup=yes,width=520,height=720')
      if (!popup) throw new Error('The browser blocked the sign-in window. Allow pop-ups for OpenSol and try again.')
      // The callback page also broadcasts; polling covers browsers that drop BroadcastChannel.
      const started = Date.now()
      const watch = window.setInterval(() => {
        void get().load()
        const server = get().servers.find((item) => item.id === id)
        if (popup.closed || server?.oauth?.authorized || Date.now() - started > 5 * 60_000) {
          window.clearInterval(watch)
          void get().load()
        }
      }, 1500)
    },
    logout: async (id) => {
      apply((await mcpLogout(id)).servers)
    },
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
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
<<<<<<< HEAD

try {
  new BroadcastChannel('opensol-mcp-oauth').onmessage = () => void useMcp.getState().load()
} catch {
  // BroadcastChannel is optional; the authorize poll still refreshes the list.
}
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
