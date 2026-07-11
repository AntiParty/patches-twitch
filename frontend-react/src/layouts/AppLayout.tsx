/* Public/marketing shell: sticky Navbar + routed content + Footer. */
import { Outlet, useLocation } from 'react-router-dom'
import { Navbar } from '@/components/navigation/Navbar'
import { Footer } from '@/components/layout/Footer'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const { pathname } = useLocation()
  const isLanding = pathname === '/'

  return (
    <div className={`${styles.shell} ${isLanding ? styles.landingShell : ''}`}>
      <Navbar />
      <main className={styles.content}>
        <Outlet />
      </main>
      <Footer variant={isLanding ? 'cinematic' : 'default'} />
    </div>
  )
}
