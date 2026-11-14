import { create } from 'zustand'
import type { McpServer, McpTool, McpToolName } from '../types'
import { ensureSession, mcpAction, mcpAuthorize, mcpList, mcpLogout, mcpSave, type McpServerInput } from '../lib/daemon'

interface McpState {
  servers: McpServer[]
  loaded: boolean
  loading: boolean
  error: string
  /** True while the daemon's live event stream is open; nothing polls then. */
  live: boolean
  load: () => Promise<void>
  /** Loads the list once and keeps it current through the daemon's event stream. Safe to call twice. */
  start: () => void
  /** One server changed (pushed by the daemon, or returned with a tool result). */
  applyServer: (server: McpServer) => void
  save: (servers: McpServerInput[]) => Promise<void>
  act: (id: string, action: 'connect' | 'disconnect' | 'refresh') => Promise<void>
  /** Opens the provider's consent page; resolves once the popup was opened. */
  authorize: (id: string) => Promise<void>
  logout: (id: string) => Promise<void>
  lookup: (fn: string) => { server: McpServer; tool: McpTool } | null
}

let pollTimer: number | undefined
let source: EventSource | null = null
let retryTimer: number | undefined

type McpEvent = { type: 'server'; server: McpServer } | { type: 'servers'; servers: McpServer[] }

export const useMcp = create<McpState>()((set, get) => {
  const apply = (servers: McpServer[]) => {
    set({ servers, loaded: true, loading: false, error: '' })
    if (pollTimer !== undefined) window.clearTimeout(pollTimer)
    pollTimer = undefined
    // Without the live stream (older browser, daemon restarting) servers that are still starting are polled.
    if (!get().live && servers.some((server) => server.status === 'connecting')) {
      pollTimer = window.setTimeout(() => void get().load(), 1200)
    }
  }

  const openStream = () => {
    if (source || typeof EventSource === 'undefined') return
    void ensureSession()
      .then(() => {
        const stream = new EventSource('/api/mcp/events', { withCredentials: true })
        source = stream
        stream.onopen = () => {
          set({ live: true })
          // Anything that changed while the stream was down is picked up once, here.
          void get().load()
        }
        stream.onmessage = (message) => {
          try {
            const event = JSON.parse(message.data) as McpEvent
            if (event.type === 'server') get().applyServer(event.server)
            else if (event.type === 'servers') apply(event.servers)
          } catch {
            // Ignore a malformed frame.
          }
        }
        stream.onerror = () => {
          set({ live: false })
          // The browser retries by itself unless the daemon refused the stream (expired session).
          if (stream.readyState === EventSource.CLOSED) {
            stream.close()
            if (source === stream) source = null
            window.clearTimeout(retryTimer)
            retryTimer = window.setTimeout(() => {
              void ensureSession(true).catch(() => undefined).then(openStream)
            }, 3000)
          }
        }
      })
      .catch(() => {
        window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(openStream, 5000)
      })
  }

  return {
    servers: [],
    loaded: false,
    loading: false,
    error: '',
    live: false,
    start: () => {
      if (!get().loaded && !get().loading) void get().load()
      openStream()
    },
    load: async () => {
      set({ loading: true })
      try {
        apply((await mcpList()).servers)
      } catch (error) {
        set({ loading: false, loaded: true, error: error instanceof Error ? error.message : 'Could not load MCP servers.' })
      }
    },
    applyServer: (server) => {
      set((state) => {
        const index = state.servers.findIndex((item) => item.id === server.id)
        const servers = index < 0 ? [...state.servers, server] : state.servers.map((item, i) => (i === index ? server : item))
        return { servers, loaded: true, loading: false, error: '' }
      })
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
    authorize: async (id) => {
      const { url } = await mcpAuthorize(id)
      const popup = window.open(url, 'opensol-mcp-oauth', 'popup=yes,width=520,height=720')
      if (!popup) throw new Error('The browser blocked the sign-in window. Allow pop-ups for OpenSol and try again.')
      // The callback page broadcasts and the daemon pushes the new status; this only covers the gap
      // when neither reaches the page (no live stream, no BroadcastChannel).
      const started = Date.now()
      const watch = window.setInterval(() => {
        if (!get().live) void get().load()
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

/** Can the agent call this server's tools right now? A reconnect in progress counts: the daemon waits for it. */
export function mcpServerUsable(server: McpServer): boolean {
  if (!server.enabled) return false
  if (server.status === 'connected') return true
  return server.reconnecting === true && server.tools.length > 0
}

try {
  new BroadcastChannel('opensol-mcp-oauth').onmessage = () => void useMcp.getState().load()
} catch {
  // BroadcastChannel is optional; the daemon's event stream still refreshes the list.
}
