import { useState } from 'react'
import { Check, ChevronDown, FolderOpen, GitBranch } from 'lucide-react'
import { useUi } from '../../store/ui'
import { useWorkspace } from '../../store/workspace'
import { Popover, MenuLabel, TextButton } from './Popover'
import { cn } from '../../lib/utils'

/** The project folder, shown above the composer. Click to switch folders. */
export function WorkspacePicker() {
  const info = useWorkspace((state) => state.info)
  const git = useWorkspace((state) => state.git)
  const addWorkspace = useWorkspace((state) => state.addWorkspace)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const notify = useUi((state) => state.notify)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState('')

  const choose = async (path: string) => {
    if (path === info.root) {
      setOpen(false)
      return
    }
    setSwitching(path)
    try {
      await addWorkspace(path)
      setOpen(false)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open that folder.', 'error')
    } finally {
      setSwitching('')
    }
  }

  const recent = [...info.workspaces].sort((a, b) => b.lastOpened - a.lastOpened)

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="below"
      width={280}
      maxHeight={260}
      trigger={
        <TextButton
          open={open}
          onClick={() => setOpen((value) => !value)}
          title={info.available ? info.root : 'Choose a project folder'}
          className="max-w-[240px]"
        >
          <FolderOpen size={13} className="shrink-0 text-faint" />
          <span className="truncate">{info.available ? info.name : 'Select folder'}</span>
          {info.available && git.available && git.branch && (
            <span className="flex shrink-0 items-center gap-0.5 text-faint">
              <GitBranch size={11} />
              {git.branch}
            </span>
          )}
          <ChevronDown size={11} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
        </TextButton>
      }
    >
      <MenuLabel>Folders</MenuLabel>
      <div>
        {recent.length === 0 && <p className="px-2 pb-2 text-[11.5px] text-faint">No folders yet.</p>}
        {recent.map((workspace) => (
          <button
            key={workspace.path}
            type="button"
            onClick={() => void choose(workspace.path)}
            disabled={Boolean(switching)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-raised disabled:opacity-60"
            title={workspace.path}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {workspace.path === info.root ? <Check size={12} className="text-accent" /> : <FolderOpen size={12} className="text-faint" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-ink">{workspace.name}</span>
              <span className="block truncate text-[10px] text-faint">{workspace.path}</span>
            </span>
            {switching === workspace.path && (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-t-transparent text-faint" />
            )}
          </button>
        ))}
      </div>
      <div className="mt-1 border-t border-line pt-1">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setWorkspaceOpen(true)
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <FolderOpen size={12} className="text-faint" />
          Open another folder…
        </button>
      </div>
    </Popover>
  )
}
