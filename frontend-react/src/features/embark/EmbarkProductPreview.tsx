import styles from './Embark.module.css'

export type EmbarkPreviewKind = 'dashboard' | 'chat' | 'tracking' | 'predictions'

const labels: Record<EmbarkPreviewKind, string> = {
  dashboard: 'Live dashboard',
  chat: 'Twitch chat',
  tracking: 'Live session tracker',
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
    <div className={styles.previewTopbar}><b># antiparty</b><span className={styles.previewViewer}>1,284 watching</span></div>
    <div className={styles.chatLines}>
      <p><b>trev_au</b><span>!rank antiparty</span></p>
      <p className={styles.botLine}>
        <em>Ranked update</em><b>FinalsRS</b><span>Diamond 3 · 43,280 RS · +482 today</span><small>Updated from live session</small>
      </p>
      <p><b>cassieplays</b><span>That climb is unreal</span></p>
      <p className={styles.chatInput}>Message #antiparty <i>⌁</i></p>
    </div>
  </>
}

function TrackingPreview() {
  return <>
    <div className={styles.previewTopbar}><b>Live session</b><span className={styles.previewLive}>01:42:18</span></div>
    <div className={styles.trackHeader}>
      <div><small>Session start</small><b>42,798 RS</b></div>
      <div><small>Current RS</small><b>43,280</b></div>
      <div className={styles.sessionChange}><small>Session change</small><b>+482 RS</b></div>
    </div>
    <div className={styles.chart}><svg viewBox="0 0 300 82" preserveAspectRatio="none" aria-hidden="true"><path d="M0 66 C26 58 34 65 56 49 S86 61 108 40 S139 50 157 32 S189 44 208 24 S242 33 260 17 S284 20 300 5" /><path className={styles.chartFill} d="M0 66 C26 58 34 65 56 49 S86 61 108 40 S139 50 157 32 S189 44 208 24 S242 33 260 17 S284 20 300 5 V82 H0Z" /></svg><div><span>Match 1</span><span>Match 3</span><span>Match 5</span><span>Live</span></div></div>
  </>
}

function PredictionsPreview() {
  return <>
    <div className={styles.previewTopbar}><b>Prediction live</b><span className={styles.previewLive}>02:14</span></div>
    <div className={styles.predictionBody}>
      <small className={styles.predictionKicker}>Open prediction</small>
      <p>Will AntiParty break 44k RS?</p>
      <div className={styles.predictionOption}><span>Yes</span><b>68%<small>10,758 points</small></b></div>
      <div className={`${styles.predictionOption} ${styles.predictionNo}`}><span>No</span><b>32%<small>5,062 points</small></b></div>
      <div className={styles.predictionMeta}><span>2,416 viewers participating</span><span>15,820 points committed</span></div>
    </div>
  </>
}
