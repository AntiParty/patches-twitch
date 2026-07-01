/*
 * Admin → Drops. Edit the public drops config (featured image + drop entries)
 * and upload images. Ported from the legacy admin drops view.
 */
import { useEffect, useState, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/cards/Card'
import { Button } from '@/components/buttons/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/Input'
import { Spinner } from '@/components/feedback/Spinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useToast } from '@/hooks/useToast'
import { ApiError } from '@/api/errors'
import { adminApi } from '@/api/admin'
import type { DropItem } from '@/types/admin'
import styles from './admin.module.css'

export function Drops() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin', 'drops'], queryFn: adminApi.getDrops })

  const [featuredImage, setFeaturedImage] = useState('')
  const [drops, setDrops] = useState<DropItem[]>([])

  useEffect(() => {
    if (!data) return
    setFeaturedImage(data.featuredImage)
    setDrops(data.drops)
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      adminApi.saveDrops({ lastUpdated: new Date().toISOString(), featuredImage: featuredImage.trim(), drops }),
  })
  const upload = useMutation({ mutationFn: (file: File) => adminApi.uploadDropImage(file) })

  const handleSave = async () => {
    try {
      await save.mutateAsync()
      toast.success('Drops configuration saved.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save drops')
    }
  }

  const handleUpload = async (file?: File) => {
    if (!file) return
    try {
      const { url } = await upload.mutateAsync(file)
      setFeaturedImage(url)
      toast.success('Image uploaded.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to upload image')
    }
  }

  const updateDrop = (i: number, patch: Partial<DropItem>) =>
    setDrops((arr) => arr.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))

  if (isLoading) return <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}><Spinner /></div>
  if (isError) return <><PageHeader title="Drops" /><ErrorState message="Failed to load drops config." onRetry={() => refetch()} /></>

  return (
    <>
      <PageHeader
        title="Drops"
        subtitle="Manage the public Twitch drops page."
        actions={<Button icon="fas fa-save" loading={save.isPending} onClick={handleSave}>Save</Button>}
      />

      <Card title="Global Settings" style={{ marginBottom: 18 }}>
        <Field label="Featured image URL">
          <div style={{ display: 'flex', gap: 10 }}>
            <Input value={featuredImage} onChange={(e) => setFeaturedImage(e.target.value)} placeholder="/uploads/…" />
            <Button variant="ghost" icon="fas fa-upload" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
              Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
          </div>
        </Field>
        {featuredImage && (
          <img src={featuredImage} alt="Featured" style={{ marginTop: 12, maxHeight: 120, borderRadius: 8, border: '1px solid var(--border)' }} />
        )}
      </Card>

      <Card
        title="Active Drops"
        subtitle={`${drops.length} / 50`}
        headerActions={
          <Button variant="ghost" size="sm" icon="fas fa-plus" disabled={drops.length >= 50} onClick={() => setDrops((d) => [...d, { name: '', category: '', duration: '' }])}>
            Add drop
          </Button>
        }
      >
        {drops.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No drops configured.</p>
        ) : (
          drops.map((d, i) => (
            <div key={i} className={styles.dropRow}>
              <Input value={d.name} placeholder="Name" onChange={(e) => updateDrop(i, { name: e.target.value })} />
              <Input value={d.category} placeholder="Category" onChange={(e) => updateDrop(i, { category: e.target.value })} />
              <Input value={d.duration} placeholder="Duration" onChange={(e) => updateDrop(i, { duration: e.target.value })} />
              <Button variant="ghost" icon="fas fa-xmark" aria-label="Remove" onClick={() => setDrops((arr) => arr.filter((_, idx) => idx !== i))} />
            </div>
          ))
        )}
      </Card>
    </>
  )
}
