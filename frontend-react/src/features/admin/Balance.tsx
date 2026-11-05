/*
 * Admin → Balance. Review queue for weekly balance changes. Changes come from
 * Embark's Steam patch notes and from thefinals.wiki; nothing touches the stored
 * weapon stats until an admin approves it. Stored stats feed the TTK table below.
 * Weapon stats are from thefinals.wiki (CC BY-SA 4.0), credited in the footer.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Badge } from '@/components/data-display/Badge'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { Select } from '@/components/forms/Select'
import { Dialog } from '@/components/modals/Dialog'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { adminApi } from '@/api/admin'
import type { BalanceChange, BalanceData, TtkWeapon } from '@/types/admin'
import styles from './admin.module.css'

const BALANCE_KEY = ['admin', 'balance'] as const
const BUILDS = ['Light', 'Medium', 'Heavy'] as const

function formatValue(value: number | null) {
  return value === null ? '—' : String(Math.round(value * 1000) / 1000)
}

function formatWhen(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : 'never'
}

function describeField(data: BalanceData, change: Pick<BalanceChange, 'kind' | 'field' | 'statLabel'>) {
  if (change.kind === 'class') return 'Health'
  if (!change.field) return change.statLabel || 'Unmapped stat'
  const mode = change.field.match(/^mode:(.+)\.(\w+)$/)
  if (mode) return `${mode[1]} ${data.fieldLabels[mode[2]] ?? mode[2]}`
  return data.fieldLabels[change.field] ?? change.field
}

interface EditState {
  change: BalanceChange
  target: string
  field: string
  toValue: string
}

export function Balance() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [edit, setEdit] = useState<EditState | null>(null)
  const [buildFilter, setBuildFilter] = useState('')
  const [search, setSearch] = useState('')

  const balance = useQuery({ queryKey: BALANCE_KEY, queryFn: adminApi.getBalance })
  const invalidate = () => qc.invalidateQueries({ queryKey: BALANCE_KEY })
  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : 'Action failed')

  const approve = useMutation({
    mutationFn: ({ id, overrides }: { id: number; overrides?: Parameters<typeof adminApi.approveBalanceChange>[1] }) =>
      adminApi.approveBalanceChange(id, overrides),
    onSuccess: () => { toast.success('Change applied.'); invalidate() },
    onError,
  })
  const reject = useMutation({
    mutationFn: (id: number) => adminApi.rejectBalanceChange(id),
    onSuccess: () => { toast.success('Change rejected.'); invalidate() },
    onError,
  })
  const sync = useMutation({
    mutationFn: () => adminApi.syncBalance(),
    onSuccess: (res) => {
      const parts = [`${res.newPatches} new patch post${res.newPatches === 1 ? '' : 's'}`]
      if (res.wiki) parts.push(`${res.wiki.changesCreated} new wiki change${res.wiki.changesCreated === 1 ? '' : 's'}`)
      if (res.errors.length) toast.warning(`${res.errors.join('; ')}. ${parts.join(', ')}.`)
      else toast.success(`Checked: ${parts.join(', ')}.`)
      invalidate()
    },
    onError,
  })

  const ttkRows = useMemo(
    () =>
      (balance.data?.ttk ?? []).filter(
        (w) =>
          (!buildFilter || w.build === buildFilter) &&
          (!search || w.name.toLowerCase().includes(search.toLowerCase())),
      ),
    [balance.data, buildFilter, search],
  )

  if (balance.isLoading) {
    return <div style={{ display: 'grid', placeItems: 'center', padding: 50 }}><Spinner /></div>
  }
  if (balance.isError || !balance.data) {
    return <ErrorState message="Failed to load balance data." onRetry={() => balance.refetch()} />
  }

  const data = balance.data
  const latestWithUnparsed = data.patches.find((p) => p.unparsed.length > 0)
  const busy = approve.isPending || reject.isPending

  const startEdit = (change: BalanceChange) =>
    setEdit({
      change,
      target: change.target,
      field: change.field ?? '',
      toValue: String(change.toValue),
    })

  const fieldsFor = (target: string) => {
    if (BUILDS.includes(target as (typeof BUILDS)[number])) return ['health']
    return data.weapons.find((w) => w.name === target)?.fields ?? []
  }

  const saveEdit = async () => {
    if (!edit) return
    const toValue = Number(edit.toValue)
    if (!edit.field) return toast.warning('Pick a stat.')
    if (edit.toValue.trim() === '' || !Number.isFinite(toValue)) return toast.warning('Value must be a number.')
    const ok = await approve
      .mutateAsync({ id: edit.change.id, overrides: { target: edit.target, field: edit.field, toValue } })
      .then(() => true, () => false)
    if (ok) setEdit(null)
  }

  const handleReject = async (c: BalanceChange) => {
    const ok = await confirm({
      title: 'Reject change',
      body: `${c.target}: ${describeField(data, c)} ${formatValue(c.fromValue)} → ${formatValue(c.toValue)}`,
      confirmLabel: 'Reject',
      danger: true,
    })
    if (ok) reject.mutate(c.id)
  }

  const renderRow = (c: BalanceChange, actionable: boolean) => (
    <tr key={c.id}>
      <td>
        <strong>{c.target}</strong>
        {c.rawTarget && c.rawTarget !== c.target && <div className={styles.subtle}>as written: {c.rawTarget}</div>}
      </td>
      <td>{describeField(data, c)}</td>
      <td className={styles.mono}>{formatValue(c.fromValue)} → {formatValue(c.toValue)}</td>
      <td className={styles.mono}>{formatValue(c.currentValue)}</td>
      <td>
        <div className={styles.chipRow}>
          <Badge variant={c.source === 'patch' ? 'primary' : 'info'}>{c.source === 'patch' ? 'Patch notes' : 'Wiki'}</Badge>
          {c.confirmedByWiki && <Badge variant="success" icon="fas fa-check">wiki confirmed</Badge>}
          {c.confirmedByPatch && c.source === 'wiki' && <Badge variant="success" icon="fas fa-check">patch confirmed</Badge>}
          {c.fromMismatch && <Badge variant="warning" icon="fas fa-triangle-exclamation">from mismatch</Badge>}
        </div>
      </td>
      <td className={styles.trollText}>{c.rawLine ?? <span className={styles.subtle}>wiki changed</span>}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {actionable ? (
          <>
            <Button size="sm" icon="fas fa-check" disabled={busy} onClick={() => approve.mutate({ id: c.id })}>Approve</Button>
            <Button variant="ghost" size="sm" icon="fas fa-pen" disabled={busy} onClick={() => startEdit(c)} aria-label="Edit before approving" />
            <Button variant="ghost" size="sm" icon="fas fa-xmark" disabled={busy} onClick={() => handleReject(c)} aria-label="Reject" />
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" icon="fas fa-pen" disabled={busy} onClick={() => startEdit(c)}>Map &amp; approve</Button>
            <Button variant="ghost" size="sm" icon="fas fa-xmark" disabled={busy} onClick={() => reject.mutate(c.id)} aria-label="Dismiss" />
          </>
        )}
      </td>
    </tr>
  )

  const changeHead = (
    <thead>
      <tr>
        <th>Target</th>
        <th>Stat</th>
        <th>From → to</th>
        <th>Stored now</th>
        <th>Source</th>
        <th>Patch line</th>
        <th />
      </tr>
    </thead>
  )

  return (
    <>
      <PageHeader
        title="Balance"
        subtitle="Weekly balance changes from the patch notes and the wiki. Approve to update the stats the TTK table uses."
        actions={
          <Button icon="fas fa-rotate" loading={sync.isPending} onClick={() => sync.mutate()}>Check now</Button>
        }
      />

      <Card
        title="Pending changes"
        subtitle={`Last patch notes check: ${formatWhen(data.lastSteamPoll)}. Last wiki sync: ${formatWhen(data.lastWikiSync)}.`}
      >
        {data.pending.length === 0 ? (
          <EmptyState icon="fas fa-scale-balanced" title="Nothing to review" description="New patch notes and wiki changes show up here." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              {changeHead}
              <tbody>{data.pending.map((c) => renderRow(c, true))}</tbody>
            </table>
          </div>
        )}
      </Card>

      {data.info.length > 0 && (
        <Card
          title="Needs a human"
          subtitle="Lines we read but can't map to a tracked stat (secondary attacks, gadgets, specializations). Map one to apply it, or dismiss."
          style={{ marginTop: 18 }}
        >
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              {changeHead}
              <tbody>{data.info.map((c) => renderRow(c, false))}</tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="Unparsed lines"
        subtitle={latestWithUnparsed ? latestWithUnparsed.title : 'Balance lines without a numeric from/to change.'}
        style={{ marginTop: 18 }}
      >
        {!latestWithUnparsed ? (
          <EmptyState icon="fas fa-check" title="No unparsed lines" description="Everything in the latest balance section was readable." />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Section</th><th>Item</th><th>Line</th></tr>
                </thead>
                <tbody>
                  {latestWithUnparsed.unparsed.map((u, i) => (
                    <tr key={i}>
                      <td>{u.category || '—'}</td>
                      <td>{u.target || '—'}</td>
                      <td className={styles.trollText}>{u.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {latestWithUnparsed.url && (
              <p className={styles.subtle} style={{ marginTop: 10 }}>
                <a href={latestWithUnparsed.url} target="_blank" rel="noreferrer">Read the full patch notes</a>
              </p>
            )}
          </>
        )}
      </Card>

      <Card
        title="Time to kill"
        subtitle={
          data.health
            ? `Every shot hits, no falloff, no healing. Health: Light ${data.health.Light}, Medium ${data.health.Medium}, Heavy ${data.health.Heavy}.`
            : 'No class health stored yet. Run a check to seed from the wiki.'
        }
        style={{ marginTop: 18 }}
        headerActions={
          <div className={styles.actions}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter weapons…"
              aria-label="Filter weapons"
            />
            <Select value={buildFilter} onChange={(e) => setBuildFilter(e.target.value)} aria-label="Class">
              <option value="">All classes</option>
              {BUILDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </div>
        }
      >
        {ttkRows.length === 0 ? (
          <EmptyState icon="fas fa-crosshairs" title="No weapons" description="Nothing matches, or the wiki hasn't been synced yet." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Weapon</th>
                  <th>Mode</th>
                  <th>Hit</th>
                  {BUILDS.map((b) => <th key={b}>{b}</th>)}
                </tr>
              </thead>
              <tbody>
                {ttkRows.flatMap((w: TtkWeapon) =>
                  w.rows.map((r, i) => (
                    <tr key={`${w.name}-${r.mode}-${r.hit}-${i}`}>
                      <td title={w.notes.join(' ')}>{i === 0 ? <strong>{w.name}</strong> : ''}{i === 0 && w.build && <span className={styles.subtle}> {w.build}</span>}</td>
                      <td>{r.mode}</td>
                      <td>{r.hit}</td>
                      {BUILDS.map((b) => {
                        const cell = r.byBuild[b]
                        return (
                          <td key={b} className={styles.mono}>
                            {cell.shots === Infinity || cell.shots == null ? '—' : `${cell.shots} shot${cell.shots === 1 ? '' : 's'}`}
                            {cell.seconds !== null && ` · ${cell.seconds.toFixed(2)}s`}
                          </td>
                        )
                      })}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
        {data.wikiSkipped.length > 0 && (
          <p className={styles.subtle} style={{ marginTop: 10 }}>
            Wiki pages we couldn't read: {data.wikiSkipped.map(String).join(', ')}
          </p>
        )}
      </Card>

      {data.recent.length > 0 && (
        <Card title="Recent decisions" style={{ marginTop: 18 }}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Target</th><th>Stat</th><th>From → to</th><th>Result</th><th>By</th></tr>
              </thead>
              <tbody>
                {data.recent.map((c) => (
                  <tr key={c.id}>
                    <td>{c.target}</td>
                    <td>{describeField(data, c)}</td>
                    <td className={styles.mono}>{formatValue(c.fromValue)} → {formatValue(c.toValue)}</td>
                    <td>{c.status === 'applied' ? <Badge variant="success">Applied</Badge> : <Badge>Rejected</Badge>}</td>
                    <td className={styles.subtle}>{c.decidedBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className={styles.subtle} style={{ marginTop: 18 }}>
        Weapon stats from{' '}
        <a href={data.wiki.baseUrl} target="_blank" rel="noreferrer">{data.wiki.name}</a>,{' '}
        <a href={data.wiki.license.url} target="_blank" rel="noreferrer">{data.wiki.license.name}</a>.
        Patch changes from Embark's official Steam announcements.
      </p>

      <Dialog
        open={edit !== null}
        onClose={() => setEdit(null)}
        title="Edit before applying"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button icon="fas fa-check" loading={approve.isPending} onClick={saveEdit}>Approve</Button>
          </>
        }
      >
        {edit && (
          <>
            {edit.change.rawLine && <p className={styles.subtle}>{edit.change.rawLine}</p>}
            <Field label="Weapon or class">
              <Select
                value={edit.target}
                onChange={(e) => {
                  const target = e.target.value
                  const fields = fieldsFor(target)
                  setEdit({ ...edit, target, field: fields.includes(edit.field) ? edit.field : fields[0] ?? '' })
                }}
              >
                {!edit.change.field && !data.weapons.some((w) => w.name === edit.target) && !BUILDS.includes(edit.target as (typeof BUILDS)[number]) && (
                  <option value={edit.target}>{edit.target} (unmatched)</option>
                )}
                <optgroup label="Classes">
                  {BUILDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </optgroup>
                <optgroup label="Weapons">
                  {data.weapons.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
                </optgroup>
              </Select>
            </Field>
            <Field label="Stat">
              <Select value={edit.field} onChange={(e) => setEdit({ ...edit, field: e.target.value })}>
                <option value="">Pick a stat…</option>
                {fieldsFor(edit.target).map((f) => (
                  <option key={f} value={f}>{describeField(data, { kind: f === 'health' ? 'class' : 'weapon', field: f, statLabel: f })}</option>
                ))}
              </Select>
            </Field>
            <Field label="New value">
              <Input type="number" step="any" value={edit.toValue} onChange={(e) => setEdit({ ...edit, toValue: e.target.value })} />
            </Field>
          </>
        )}
      </Dialog>
    </>
  )
}
