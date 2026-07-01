/*
 * Commands tab. Edit the rank/record/peak chat responses with variable chips
 * and a live preview. Ported from the legacy commands view + its inline JS.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Input } from '@/components/forms/Input'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { useAuth } from '@/hooks/useAuth'
import { ApiError } from '@/api/errors'
import { commandsApi } from '@/api/commands'
import { useCommands, COMMANDS_KEY } from './hooks'
import styles from './Commands.module.css'

type CommandId = 'rank' | 'record' | 'peak'
const COMMAND_IDS: CommandId[] = ['rank', 'record', 'peak']

interface VarDef {
  v: string
  desc: string
}

const CMD_VARS: Record<CommandId, VarDef[]> = {
  rank: [
    { v: 'username', desc: "Viewer's display name" },
    { v: 'rank', desc: 'Global leaderboard rank' },
    { v: 'league', desc: 'League (e.g. Diamond 1)' },
    { v: 'score', desc: 'Rank Score (RS)' },
    { v: 'found', desc: 'true/false — on leaderboard?' },
  ],
  record: [
    { v: 'username', desc: "Viewer's display name" },
    { v: 'sessionRS', desc: 'RS gained/lost this stream' },
    { v: 'gain', desc: 'Alias for {sessionRS}' },
    { v: 'currentRS', desc: 'Current RS total' },
    { v: 'startRS', desc: 'RS at stream start' },
  ],
  peak: [
    { v: 'rank', desc: 'Best rank ever achieved' },
    { v: 'league', desc: 'League at peak rank' },
    { v: 'score', desc: 'RS at peak rank' },
    { v: 'season', desc: 'Season of peak rank' },
  ],
}

const CMD_DEFAULTS: Record<CommandId, string> = {
  rank: '@{username}, current rank is {score} RS in {league}',
  record: '@{username}, session RS: {sessionRS} ({currentRS} RS)',
  peak: 'Peak rank: #{rank} {league} ({score} RS) in {season}',
}

function mockValues(username: string): Record<CommandId, Record<string, string>> {
  return {
    rank: { username, rank: '142', league: 'Diamond 1', score: '45,210', found: 'true' },
    record: { username, sessionRS: '+312', gain: '+312', currentRS: '45,210', startRS: '44,898' },
    peak: { rank: '23', league: 'Ruby', score: '52,100', season: 'Season 8' },
  }
}

export function Commands() {
  const { user } = useAuth()
  const username = user?.username ?? 'you'
  const { data, isLoading } = useCommands()
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const [values, setValues] = useState<Record<CommandId, string>>({ rank: '', record: '', peak: '' })
  const [active, setActive] = useState<CommandId>('rank')
  const inputRefs = useRef<Record<CommandId, HTMLInputElement | null>>({ rank: null, record: null, peak: null })

  // Sync local edit state when the server data arrives.
  useEffect(() => {
    if (!data?.commands) return
    setValues({
      rank: data.commands.find((c) => c.name === 'rank')?.response ?? '',
      record: data.commands.find((c) => c.name === 'record')?.response ?? '',
      peak: data.commands.find((c) => c.name === 'peak')?.response ?? '',
    })
  }, [data])

  const save = useMutation({
    mutationFn: ({ name, response }: { name: CommandId; response: string }) =>
      commandsApi.save(name, response),
    onSuccess: () => qc.invalidateQueries({ queryKey: COMMANDS_KEY }),
  })

  const handleSave = async (cmd: CommandId) => {
    try {
      await save.mutateAsync({ name: cmd, response: values[cmd] })
      toast.success(`!${cmd} updated`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save')
    }
  }

  const handleReset = async (cmd: CommandId) => {
    const ok = await confirm({
      title: `Reset !${cmd}`,
      body: `Remove your custom response for !${cmd}? The bot will use its built-in default.`,
      confirmLabel: 'Reset',
      danger: true,
    })
    if (!ok) return
    setValues((v) => ({ ...v, [cmd]: '' }))
    try {
      await save.mutateAsync({ name: cmd, response: '' })
      toast.success(`!${cmd} reset to default`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reset')
    }
  }

  const insertVariable = (cmd: CommandId, token: string) => {
    const input = inputRefs.current[cmd]
    const current = values[cmd]
    const start = input?.selectionStart ?? current.length
    const end = input?.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    setValues((v) => ({ ...v, [cmd]: next }))
    requestAnimationFrame(() => {
      if (input) {
        input.focus()
        const pos = start + token.length
        input.setSelectionRange(pos, pos)
      }
    })
  }

  const mocks = useMemo(() => mockValues(username), [username])
  const preview = useMemo(() => {
    const val = values[active]
    const isCustom = val.trim().length > 0
    const template = isCustom ? val : CMD_DEFAULTS[active]
    const text = template.replace(/\{(\w+)\}/g, (m, v: string) => mocks[active][v] ?? m)
    return { isCustom, text }
  }, [active, values, mocks])

  return (
    <>
      <PageHeader
        title="My Commands"
        actions={
          <Button variant="ghost" icon="fas fa-sync" onClick={() => qc.invalidateQueries({ queryKey: COMMANDS_KEY })}>
            Refresh
          </Button>
        }
      />

      <div className={styles.split}>
        {/* Editor */}
        <Card title="Edit Responses">
          <div className={styles.cmdList}>
            {COMMAND_IDS.map((cmd) => {
              const isCustom = values[cmd].trim().length > 0
              return (
                <div key={cmd} className={styles.cmdRow}>
                  <div className={styles.cmdRowHead}>
                    <span className={styles.cmdName}>!{cmd}</span>
                    <div className={styles.cmdRowActions}>
                      <span className={`${styles.stateTag} ${isCustom ? styles.stateCustom : styles.stateDefault}`}>
                        {isCustom ? 'Custom' : 'Default'}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => handleReset(cmd)} title="Reset to default">
                        Reset
                      </Button>
                    </div>
                  </div>
                  <div className={styles.cmdInputRow}>
                    <Input
                      ref={(el) => {
                        inputRefs.current[cmd] = el
                      }}
                      value={values[cmd]}
                      placeholder="Leave blank to use the default response…"
                      onFocus={() => setActive(cmd)}
                      onChange={(e) => {
                        setActive(cmd)
                        setValues((v) => ({ ...v, [cmd]: e.target.value }))
                      }}
                    />
                    <Button onClick={() => handleSave(cmd)} loading={save.isPending}>
                      Save
                    </Button>
                  </div>
                </div>
              )
            })}
            {isLoading && <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</p>}
          </div>

          {/* Variables for the active command */}
          <div className={styles.varsPanel}>
            <div className={styles.varsHead}>
              <span>
                Available Variables{' '}
                <span style={{ color: 'var(--primary)', fontWeight: 400, fontSize: 11 }}>for !{active}</span>
              </span>
              <span className={styles.varsHint}>Click to insert</span>
            </div>
            <div className={styles.varsGrid}>
              {CMD_VARS[active].map(({ v, desc }) => (
                <button
                  key={v}
                  type="button"
                  className={styles.varChip}
                  onClick={() => insertVariable(active, `{${v}}`)}
                  title="Click to insert"
                >
                  <code>{`{${v}}`}</code>
                  <div>{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Live preview */}
        <Card title="Live Preview">
          <div className={styles.preview}>
            <div className={styles.previewHeader}>
              <span>STREAM CHAT</span>
              <i className="fas fa-users" />
            </div>
            <div className={styles.previewBody}>
              <div className={styles.msg}>
                <span className={styles.msgUser} style={{ color: '#5aa7ff' }}>
                  Viewer123
                </span>
                : !{active}
              </div>
              <div className={styles.msg} style={{ opacity: 1 }}>
                <span className={styles.msgBot}>FinalsRS</span>:{' '}
                <span style={{ color: preview.isCustom ? '#efeff1' : '#adadb8' }}>{preview.text}</span>
              </div>
            </div>
          </div>
          <div className={styles.previewNote}>This is how the bot will respond in your chat.</div>
        </Card>
      </div>
    </>
  )
}
