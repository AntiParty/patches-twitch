import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <h1 className="section-title">404</h1>
        <p className="section-lede" style={{ margin: '0 auto 20px' }}>
          This page hasn't been migrated yet, or doesn't exist.
        </p>
        <Link className="btn btn-primary" to="/">
          Back home
        </Link>
      </div>
    </main>
  )
}
