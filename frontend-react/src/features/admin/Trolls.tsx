/*
 * Admin → Trolls. Rare joke replies that fire instead of (or before) a real
 * command, only in channels an admin has armed. The bot picks up changes
 * within ~30s (its troll cache TTL) and trolls at most once a minute per channel.
 * Open to Staff as well as admins; it's the only admin page Staff can reach.
 */
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Badge } from '@/components/data-display/Badge'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { Select } from '@/components/forms/Select'
import { Textarea } from '@/components/forms/Textarea'
import { SearchBar } from '@/components/forms/SearchBar'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { adminApi } from '@/api/admin'
import type { NewTroll, TrollResponse } from '@/types/admin'
import styles from './admin.module.css'

const TROLLS_KEY = ['admin', 'trolls'] as const
const MAX_LENGTH = 400

const STARTER_PACK: Omit<NewTroll, 'channel'>[] = [
  { command: 'rank', response: '{ign} is too low.... not even worth looking up', chance: 3, followUp: false },
  { command: 'rank', response: 'Rank: Bronze 4. Source: trust me bro', chance: 2, followUp: true },
  { command: 'rank', response: "{ign} asked me not to say. it's that bad.", chance: 2, followUp: false },
  { command: 'rank', response: 'Scanning... {ign} is {percent}% bot. Ruby when? never.', chance: 2, followUp: true },
  { command: 'peak', response: "{ign}'s peak was the friends we made along the way", chance: 4, followUp: true },
  { command: 'record', response: 'W/L: yes.', chance: 4, followUp: true },
  { command: 'goal', response: 'Goal: touch grass. Progress: 0%', chance: 4, followUp: true },
  { command: '*', response: "@{user} I'm on break, ask again later", chance: 1, followUp: false },
]

const EMPTY_FORM: NewTroll = { command: 'rank', channel: null, response: '', chance: 3, followUp: false }

function commandLabel(command: string) {
  return command === '*' ? 'any command' : `!${command}`
}

export function Trolls() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const responseRef = useRef<HTMLTextAreaElement>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<NewTroll>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const trolls = useQuery({ queryKey: TROLLS_KEY, queryFn: adminApi.getTrolls })

  const invalidate = () => qc.invalidateQueries({ queryKey: TROLLS_KEY })
  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : 'Action failed')

  const armed = useMemo(() => new Set(trolls.data?.armedChannels ?? []), [trolls.data])
  const channelList = useMemo(
    () =>
      (trolls.data?.channels ?? [])
        .filter((c) => !search || c.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => Number(armed.has(b)) - Number(armed.has(a))),
    [trolls.data, search, armed],
  )

  const setArmed = useMutation({
    mutationFn: ({ channel, value }: { channel: string; value: boolean }) => adminApi.setTrollChannel(channel, value),
    onSuccess: invalidate,
    onError,
  })
  const create = useMutation({
    mutationFn: (troll: NewTroll) => adminApi.createTroll(troll),
    onSuccess: () => { toast.success('Troll loaded.'); invalidate() },
    onError,
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof adminApi.updateTroll>[1] }) =>
      adminApi.updateTroll(id, patch),
    onSuccess: invalidate,
    onError,
  })
  const remove = useMutation({
    mutationFn: (id: number) => adminApi.deleteTroll(id),
    onSuccess: () => { toast.success('Troll deleted'); invalidate() },
    onError,
  })
  const runPreview = useMutation({
    mutationFn: () => adminApi.previewTroll(form.response, form.command, form.channel ?? undefined),
    onSuccess: (res) => setPreview(res.text),
    onError,
  })

  const insertPlaceholder = (key: string) => {
    const token = `{${key}}`
    const el = responseRef.current
    const start = el?.selectionStart ?? form.response.length
    const end = el?.selectionEnd ?? form.response.length
    setForm((f) => ({ ...f, response: f.response.slice(0, start) + token + f.response.slice(end) }))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const handleCreate = async () => {
    if (!form.response.trim()) return toast.warning('Write the troll first.')
    await create.mutateAsync({ ...form, response: form.response.trim() }).catch(() => undefined)
    setForm((f) => ({ ...EMPTY_FORM, command: f.command, channel: f.channel }))
    setPreview(null)
  }

  const startEdit = (t: TrollResponse) => {
    setEditingId(t.id)
    setForm({ command: t.command, channel: t.channel, response: t.response, chance: t.chance, followUp: t.followUp })
    setPreview(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    requestAnimationFrame(() => responseRef.current?.focus())
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm((f) => ({ ...EMPTY_FORM, command: f.command, channel: f.channel }))
    setPreview(null)
  }

  const handleSave = async () => {
    if (editingId === null) return
    if (!form.response.trim()) return toast.warning('Write the troll first.')
    const saved = await update
      .mutateAsync({ id: editingId, patch: { ...form, response: form.response.trim() } })
      .then(() => true, () => false)
    if (!saved) return
    toast.success('Troll updated.')
    cancelEdit()
  }

  const handleDelete = async (t: TrollResponse) => {
    const ok = await confirm({ title: 'Delete troll', body: `"${t.response}"`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    remove.mutate(t.id)
    if (t.id === editingId) cancelEdit()
  }

  if (trolls.isLoading) {
    return <div style={{ display: 'grid', placeItems: 'center', padding: 50 }}><Spinner /></div>
  }
  if (trolls.isError || !trolls.data) {
    return <ErrorState message="Failed to load trolls." onRetry={() => trolls.refetch()} />
  }

  const { commands, placeholders } = trolls.data
  // Keep an edited troll's channel selectable even if it has since been disarmed.
  const channelOptions = [...new Set([...armed, ...(form.channel ? [form.channel] : [])])].sort()

  return (
    <>
      <PageHeader
        title="Trolls"
        subtitle="Rare joke replies that fire on commands in armed channels. At most one per channel per minute."
      />

      <div className={styles.opGrid} ref={formRef}>
        <Card title={editingId === null ? 'New troll' : 'Edit troll'}>
          <div className={styles.trollForm}>
            <Field label="Command">
              <Select value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })}>
                {commands.map((c) => <option key={c} value={c}>{commandLabel(c)}</option>)}
              </Select>
            </Field>
            <Field label="Channel">
              <Select
                value={form.channel ?? ''}
                onChange={(e) => setForm({ ...form, channel: e.target.value || null })}
              >
                <option value="">All armed channels</option>
                {channelOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Chance %" hint="Per use of the command">
              <Input
                type="number"
                min={0.1}
                max={100}
                step={0.5}
                value={form.chance}
                onChange={(e) => setForm({ ...form, chance: Number(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="Response" hint={`${form.response.length}/${MAX_LENGTH}`}>
            <Textarea
              ref={responseRef}
              value={form.response}
              onChange={(e) => { setForm({ ...form, response: e.target.value }); setPreview(null) }}
              placeholder="{ign} is too low...."
              rows={3}
              maxLength={MAX_LENGTH}
            />
          </Field>

          <div className={styles.chipRow} style={{ marginBottom: 12 }}>
            {placeholders.map((p) => (
              <button key={p} type="button" className={styles.placeholderChip} onClick={() => insertPlaceholder(p)}>
                {`{${p}}`}
              </button>
            ))}
          </div>

          <label className={styles.channelRow} style={{ padding: '4px 0' }}>
            <input
              type="checkbox"
              checked={form.followUp}
              onChange={(e) => setForm({ ...form, followUp: e.target.checked })}
            />
            <span>Still send the real answer afterwards</span>
          </label>

          {preview !== null && (
            <div className={styles.trollPreview}>
              <span className={styles.subtle}>joe: {form.command === '*' ? '!rank' : `!${form.command}`}</span>
              <span>Patches: {preview}</span>
            </div>
          )}

          <div className={styles.actions} style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <Button
              variant="ghost"
              icon="fas fa-eye"
              loading={runPreview.isPending}
              disabled={!form.response.trim()}
              onClick={() => runPreview.mutate()}
            >
              Preview
            </Button>
            {editingId === null ? (
              <Button icon="fas fa-plus" loading={create.isPending} onClick={handleCreate}>Add troll</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={cancelEdit}>Cancel</Button>
                <Button icon="fas fa-check" loading={update.isPending} onClick={handleSave}>Save changes</Button>
              </>
            )}
          </div>

          {editingId === null && <div className={styles.starterPack}>
            <span className={styles.subtle}>Starter pack, click to load into the form:</span>
            <div className={styles.chipRow}>
              {STARTER_PACK.map((s) => (
                <button
                  key={s.response}
                  type="button"
                  className={styles.statChip}
                  title={s.response}
                  onClick={() => { setForm({ ...s, channel: form.channel }); setPreview(null) }}
                >
                  <code>{commandLabel(s.command)}</code>
                  {s.response.length > 28 ? `${s.response.slice(0, 28)}…` : s.response}
                </button>
              ))}
            </div>
          </div>}
        </Card>

        <Card
          title="Armed channels"
          subtitle="Trolls only fire where this is on."
          headerActions={<span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{armed.size} armed</span>}
        >
          <div style={{ marginBottom: 12 }}>
            <SearchBar value={search} onChange={setSearch} placeholder="Filter channels…" />
          </div>
          <div className={styles.channelPicker}>
            {channelList.map((c) => (
              <label key={c} className={styles.channelRow}>
                <input
                  type="checkbox"
                  checked={armed.has(c)}
                  disabled={setArmed.isPending}
                  onChange={(e) => setArmed.mutate({ channel: c, value: e.target.checked })}
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Loaded trolls" style={{ marginTop: 18 }}>
        {trolls.data.trolls.length === 0 ? (
          <EmptyState icon="fas fa-masks-theater" title="No trolls yet" description="Add one above, or grab something from the starter pack." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Channel</th>
                  <th>Response</th>
                  <th>Chance</th>
                  <th>Then answer</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trolls.data.trolls.map((t) => (
                  <tr key={t.id}>
                    <td className={styles.mono}>{commandLabel(t.command)}</td>
                    <td>{t.channel ?? <span className={styles.subtle}>all armed</span>}</td>
                    <td className={styles.trollText}>{t.response}</td>
                    <td>
                      <Input
                        key={t.chance}
                        type="number"
                        min={0.1}
                        max={100}
                        step={0.5}
                        defaultValue={t.chance}
                        className={styles.chanceInput}
                        aria-label="Chance percent"
                        onBlur={(e) => {
                          const chance = Number(e.target.value)
                          if (chance !== t.chance) update.mutate({ id: t.id, patch: { chance } })
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={t.followUp}
                        aria-label="Send the real answer afterwards"
                        onChange={(e) => update.mutate({ id: t.id, patch: { followUp: e.target.checked } })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.badgeButton}
                        onClick={() => update.mutate({ id: t.id, patch: { enabled: !t.enabled } })}
                        title="Click to toggle"
                      >
                        {t.enabled ? <Badge variant="success">On</Badge> : <Badge>Off</Badge>}
                      </button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Button variant="ghost" size="sm" icon="fas fa-pen" onClick={() => startEdit(t)} aria-label="Edit troll" />
                      <Button variant="ghost" size="sm" icon="fas fa-trash" onClick={() => handleDelete(t)} aria-label="Delete troll" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
