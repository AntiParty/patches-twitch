/*
 * Generic data table. Mirrors the legacy `.table-container` / `table` styles.
 * Define typed columns; optionally provide a custom cell renderer.
 */
import type { ReactNode } from 'react'
import { Spinner } from '@/components/feedback/Spinner'
import { EmptyState } from '@/components/feedback/EmptyState'
import styles from './Table.module.css'

export interface Column<T> {
  /** Unique key; also used to read the value when no render() is given. */
  key: string
  header: ReactNode
  /** Custom cell renderer. */
  render?: (row: T, index: number) => ReactNode
  /** Value accessor when not using render(). */
  accessor?: (row: T) => ReactNode
  align?: 'left' | 'center' | 'right'
  width?: string | number
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string | number
  loading?: boolean
  emptyMessage?: string
  onRowClick?: (row: T) => void
}

export function Table<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyMessage = 'No data',
  onRowClick,
}: TableProps<T>) {
  if (loading) {
    return (
      <div className={styles.center}>
        <Spinner />
      </div>
    )
  }
  if (data.length === 0) {
    return <EmptyState icon="fas fa-table" title={emptyMessage} />
  }

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align, width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? styles.clickable : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }}>
                  {c.render
                    ? c.render(row, i)
                    : c.accessor
                      ? c.accessor(row)
                      : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
