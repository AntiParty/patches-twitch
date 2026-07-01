/*
 * Admin → Message Bot. Send one message to explicitly selected channels.
 * No broadcast mode. Ported from the legacy admin messaging view.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Textarea } from '@/components/forms/Textarea'
import { SearchBar } from '@/components/forms/SearchBar'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useToast } from '@/hooks/useToast'
import { useConfirm } from '@/hooks/useConfirm'
import { ApiError } from '@/api/errors'
import { adminApi } from '@/api/admin'
import styles from './admin.module.css'

export function MessageBot() {
  const toast = useToast()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'channels'],
    queryFn: adminApi.getChannels,
  })

  const channels = useMemo(
    () => (data?.channels ?? []).filter((c) => !search || c.username.toLowerCase().includes(search.toLowerCase())),
    [data, search],
  )

  const toggle = (username: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(username) ? next.delete(username) : next.add(username)
      return next
    })

  const send = useMutation({
    mutationFn: () => adminApi.sendMessage([...selected], message.trim()),
  })

  const handleSend = async () => {
    if (selected.size === 0) return toast.warning('Select at least one channel.')
    if (!message.trim()) return toast.warning('Enter a message.')
    const ok = await confirm({
      title: 'Send message',
      body: `Send this message to ${selected.size} channel${selected.size > 1 ? 's' : ''}?`,
      confirmLabel: 'Send',
    })
    if (!ok) return
    try {
      await send.mutateAsync()
      toast.success(`Message sent to ${selected.size} channel${selected.size > 1 ? 's' : ''}.`)
      setMessage('')
      setSelected(new Set())
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send message')
    }
  }

  return (
    <>
      <PageHeader title="Message Bot" subtitle="Send one message to explicitly selected channels. There is no broadcast mode." />

      <div className={styles.opGrid}>
        <Card title="Channels" headerActions={<span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{selected.size} selected</span>}>
          <div style={{ marginBottom: 12 }}>
            <SearchBar value={search} onChange={setSearch} placeholder="Filter channels…" />
          </div>
          {isLoading ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: 30 }}><Spinner /></div>
          ) : isError ? (
            <ErrorState message="Failed to load channels." onRetry={() => refetch()} />
          ) : (
            <div className={styles.channelPicker}>
              {channels.map((c) => (
                <label key={c.id} className={styles.channelRow}>
                  <input type="checkbox" checked={selected.has(c.username)} onChange={() => toggle(c.username)} />
                  <span>{c.username}</span>
                </label>
              ))}
            </div>
          )}
        </Card>

        <Card title="Message">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type the message to send…"
            rows={6}
            maxLength={450}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>{message.length}/450</span>
            <Button icon="fas fa-paper-plane" loading={send.isPending} onClick={handleSend}>
              Send to {selected.size || 0}
            </Button>
          </div>
        </Card>
      </div>
    </>
  )
}
