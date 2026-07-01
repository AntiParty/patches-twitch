/* Public/marketing shell: sticky Navbar + routed content + Footer. */
import { Outlet } from 'react-router-dom'
import { Navbar } from '@/components/navigation/Navbar'
import { Footer } from '@/components/layout/Footer'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={`fx-bg ${styles.shell}`}>
      <Navbar />
      <main className={styles.content}>
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
