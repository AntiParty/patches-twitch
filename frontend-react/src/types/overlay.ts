/** Overlay config shapes. */

export interface OverlayVisibility {
  hideName?: boolean
  hideRank?: boolean
  hideScore?: boolean
  hideSession?: boolean
}

export interface OverlayLayout {
  mode?: string
  visibility?: OverlayVisibility
}

/** GET /api/overlay/config/:token */
export interface OverlayConfig {
  theme: string
  primaryColor: string
  layout: OverlayLayout | null
}

/** POST /api/overlay/config body */
export interface OverlayConfigInput {
  theme: string
  primaryColor: string
  layoutMode: string
  visibility: OverlayVisibility
}

export interface OverlayTokenResponse {
  token: string
}
