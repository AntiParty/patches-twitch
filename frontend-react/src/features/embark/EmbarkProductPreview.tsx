import styles from './Embark.module.css'

export type EmbarkPreviewKind = 'dashboard' | 'chat' | 'tracking' | 'predictions'

const labels: Record<EmbarkPreviewKind, string> = {
  dashboard: 'Live dashboard',
  chat: 'Twitch chat',
  tracking: 'Rank progression',
  predictions: 'Prediction control',
}

export function EmbarkProductPreview({ kind }: { kind: EmbarkPreviewKind }) {
  return (
    <div className={styles.preview} data-preview={kind} aria-label={labels[kind]} role="img">
      {kind === 'dashboard' && <DashboardPreview />}
      {kind === 'chat' && <ChatPreview />}
      {kind === 'tracking' && <TrackingPreview />}
      {kind === 'predictions' && <PredictionsPreview />}
    </div>
  )
}

function DashboardPreview() {
  return <>
    <div className={styles.previewTopbar}><b>FinalsRS</b><span className={styles.previewLive}>Live</span><i /></div>
    <div className={styles.previewDashboard}>
      <aside><span>Overview</span><span>Commands</span><span>Overlays</span><span>Settings</span></aside>
      <div className={styles.previewMain}>
        <p>GOOD EVENING, ANTIPARTY</p><strong>Stream control</strong>
        <div className={styles.previewStatRow}><div><small>SESSION RS</small><b>43,280</b><em>+482 today</em></div><div><small>CHAT LOOKUPS</small><b>126</b><em>Live now</em></div></div>
      </div>
    </div>
  </>
}

function ChatPreview() {
  return <>
    <div className={styles.previewTopbar}><b># antiparty</b><span className={styles.previewViewer}>1,284 viewers</span></div>
    <div className={styles.chatLines}>
      <p><b>trev_au</b> <span>!rank</span></p>
      <p className={styles.botLine}><b>FinalsRS</b><span>ANTIPARTY is Diamond 3 · 43,280 RS</span></p>
      <p><b>cassieplays</b> <span>huge session gain</span></p>
      <p className={styles.chatInput}>Send a message <i>⌁</i></p>
    </div>
  </>
}

function TrackingPreview() {
  return <>
    <div className={styles.previewTopbar}><b>Ranked progress</b><span>Season 8</span></div>
    <div className={styles.trackHeader}><div><small>CURRENT</small><b>Diamond 3</b></div><div><small>PEAK</small><b>43,701</b></div></div>
    <div className={styles.chart}><svg viewBox="0 0 300 82" preserveAspectRatio="none" aria-hidden="true"><path d="M0 66 C26 58 34 65 56 49 S86 61 108 40 S139 50 157 32 S189 44 208 24 S242 33 260 17 S284 20 300 5" /><path className={styles.chartFill} d="M0 66 C26 58 34 65 56 49 S86 61 108 40 S139 50 157 32 S189 44 208 24 S242 33 260 17 S284 20 300 5 V82 H0Z" /></svg><div><span>Mon</span><span>Wed</span><span>Fri</span><span>Now</span></div></div>
  </>
}

function PredictionsPreview() {
  return <>
    <div className={styles.previewTopbar}><b>Prediction live</b><span className={styles.previewLive}>03:18</span></div>
    <div className={styles.predictionBody}><p>Will we reach 44k RS tonight?</p><div className={styles.predictionOption}><span>YES</span><b>68%</b></div><div className={`${styles.predictionOption} ${styles.predictionNo}`}><span>NO</span><b>32%</b></div><small>1,842 channel points committed</small></div>
  </>
}
