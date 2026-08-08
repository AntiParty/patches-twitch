import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { commandsApi } from '@/api/commands'
import { ApiError } from '@/api/errors'
import { Button } from '@/components/buttons/Button'
import { Card } from '@/components/cards/Card'
import { Dialog } from '@/components/modals/Dialog'
import { Input } from '@/components/forms/Input'
import { Textarea } from '@/components/forms/Textarea'
import { PageHeader } from '@/components/layout/PageHeader'
import { useConfirm } from '@/hooks/useConfirm'
import { useToast } from '@/hooks/useToast'
import { COMMANDS_KEY, useCommands } from './hooks'
import styles from './Commands.module.css'

type CommandId = 'rank' | 'record' | 'peak'

const EDITABLE_COMMANDS = new Set<string>(['rank', 'record', 'peak'])
const COMMAND_CONTROLS_KEY = ['dashboard', 'command-controls'] as const

const COMMAND_DEFAULTS: Record<CommandId, string> = {
  rank: '@{username}, current rank is {score} RS in {league}',
  record: '@{username}, session RS: {sessionRS} ({currentRS} RS)',
  peak: 'Peak rank: #{rank} {league} ({score} RS) in {season}',
}

const COMMAND_VARIABLES: Record<CommandId, Array<{ token: string; description: string }>> = {
  rank: [
    { token: '{username}', description: "Viewer's display name" },
    { token: '{rank}', description: 'Global leaderboard rank' },
    { token: '{league}', description: 'Current league' },
    { token: '{score}', description: 'Rank Score' },
    { token: '{found}', description: 'Leaderboard result' },
  ],
  record: [
    { token: '{username}', description: "Viewer's display name" },
    { token: '{sessionRS}', description: 'Session RS change' },
    { token: '{gain}', description: 'Session RS alias' },
    { token: '{currentRS}', description: 'Current RS total' },
    { token: '{startRS}', description: 'Starting RS total' },
  ],
  peak: [
    { token: '{rank}', description: 'Best rank achieved' },
    { token: '{league}', description: 'League at peak' },
    { token: '{score}', description: 'RS at peak' },
    { token: '{season}', description: 'Peak season' },
  ],
}

function isEditableCommand(name: string): name is CommandId {
  return EDITABLE_COMMANDS.has(name)
}

export function Commands() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const { data: responses, isLoading: responsesLoading } = useCommands()
  const { data: controls, isLoading: controlsLoading } = useQuery({
    queryKey: COMMAND_CONTROLS_KEY,
    queryFn: commandsApi.listControls,
  })

  const [search, setSearch] = useState('')
  const [values, setValues] = useState<Record<CommandId, string>>({ rank: '', record: '', peak: '' })
  const [editing, setEditing] = useState<CommandId | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!responses?.commands) return
    setValues({
      rank: responses.commands.find((command) => command.name === 'rank')?.response ?? '',
      record: responses.commands.find((command) => command.name === 'record')?.response ?? '',
      peak: responses.commands.find((command) => command.name === 'peak')?.response ?? '',
    })
  }, [responses])

  const saveResponse = useMutation({
    mutationFn: ({ name, response }: { name: CommandId; response: string }) => commandsApi.save(name, response),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMMANDS_KEY }),
  })

  const setEnabled = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => commandsApi.setEnabled(name, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMMAND_CONTROLS_KEY }),
  })

  const visibleCommands = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return controls?.commands ?? []
    return (controls?.commands ?? []).filter((command) =>
      command.name.toLowerCase().includes(term) || command.label.toLowerCase().includes(term),
    )
  }, [controls, search])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: COMMANDS_KEY })
    void queryClient.invalidateQueries({ queryKey: COMMAND_CONTROLS_KEY })
  }

  const toggleCommand = async (name: string, enabled: boolean) => {
    try {
      await setEnabled.mutateAsync({ name, enabled })
      toast.success(`!${name} ${enabled ? 'enabled' : 'disabled'}`)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update command')
    }
  }

  const saveCommand = async (name: CommandId) => {
    try {
      await saveResponse.mutateAsync({ name, response: values[name] })
      toast.success(`!${name} updated`)
      setEditing(null)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to save response')
    }
  }

  const resetCommand = async (name: CommandId) => {
    const approved = await confirm({
      title: `Reset !${name}`,
      body: `Remove the custom response for !${name}? The built-in response will be restored.`,
      confirmLabel: 'Reset response',
      danger: true,
    })
    if (!approved) return

    try {
      await saveResponse.mutateAsync({ name, response: '' })
      setValues((current) => ({ ...current, [name]: '' }))
      toast.success(`!${name} reset to default`)
      setEditing(null)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to reset response')
    }
  }

  const insertVariable = (token: string) => {
    if (!editing) return
    const textarea = textareaRef.current
    const response = values[editing]
    const start = textarea?.selectionStart ?? response.length
    const end = textarea?.selectionEnd ?? response.length
    setValues((current) => ({
      ...current,
      [editing]: response.slice(0, start) + token + response.slice(end),
    }))
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const loading = controlsLoading || responsesLoading

  return (
    <>
      <PageHeader
        title="My Commands"
        subtitle="Control which commands respond in chat and customize supported responses."
        actions={<Button variant="ghost" icon="fas fa-sync" onClick={refresh}>Refresh</Button>}
      />

      <div className={styles.toolbar}>
        <i className="fas fa-search" aria-hidden="true" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search commands..."
          aria-label="Search commands"
        />
      </div>

      <Card className={styles.commandCard}>
        <div className={styles.tableScroll}>
          <table className={styles.commandTable}>
            <thead>
              <tr>
                <th>Command</th>
                <th>Description or response</th>
                <th>Status</th>
                <th><span className={styles.srOnly}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleCommands.map((command) => {
                const commandId = isEditableCommand(command.name) ? command.name : null
                const customResponse = commandId ? values[commandId].trim() : ''
                const response = commandId ? customResponse || COMMAND_DEFAULTS[commandId] : command.label
                return (
                  <tr key={command.name}>
                    <td><span className={styles.commandName}>!{command.name}</span></td>
                    <td>
                      <div className={styles.responseCell}>
                        <span>{response}</span>
                        {commandId && <small>{customResponse ? 'Custom response' : 'Default response'}</small>}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`${styles.toggle} ${command.enabled ? styles.toggleOn : ''}`}
                        aria-label={`${command.enabled ? 'Disable' : 'Enable'} !${command.name}`}
                        aria-pressed={command.enabled}
                        disabled={setEnabled.isPending && setEnabled.variables?.name === command.name}
                        onClick={() => toggleCommand(command.name, !command.enabled)}
                      >
                        <span />
                      </button>
                    </td>
                    <td>
                      {commandId && (
                        <Button variant="ghost" size="sm" icon="fas fa-pen" onClick={() => setEditing(commandId)}>
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {loading && <div className={styles.tableState}>Loading commands...</div>}
        {!loading && visibleCommands.length === 0 && <div className={styles.tableState}>No commands match “{search}”.</div>}
      </Card>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit !${editing}` : 'Edit command'}
        width={680}
        dismissable={!saveResponse.isPending}
        footer={editing && (
          <>
            <Button variant="ghost" onClick={() => resetCommand(editing)}>Reset to default</Button>
            <Button loading={saveResponse.isPending} onClick={() => saveCommand(editing)}>Save changes</Button>
          </>
        )}
      >
        {editing && (
          <div className={styles.editor}>
            <div className={styles.commandSummary}>
              <span className={styles.commandName}>!{editing}</span>
              <span>{values[editing].trim() ? 'Custom response' : 'Using built-in response'}</span>
            </div>

            <label className={styles.fieldLabel} htmlFor="command-response">Response</label>
            <Textarea
              ref={textareaRef}
              id="command-response"
              rows={5}
              maxLength={50}
              value={values[editing]}
              placeholder={COMMAND_DEFAULTS[editing]}
              onChange={(event) => setValues((current) => ({ ...current, [editing]: event.target.value }))}
            />
            <div className={styles.characterCount}>{values[editing].length} / 50</div>

            <div className={styles.variableHeader}>
              <span>Variables</span>
              <small>Insert at cursor</small>
            </div>
            <div className={styles.variableGrid}>
              {COMMAND_VARIABLES[editing].map((variable) => (
                <button key={variable.token} type="button" className={styles.variable} onClick={() => insertVariable(variable.token)}>
                  <code>{variable.token}</code>
                  <span>{variable.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Dialog>
    </>
  )
}
