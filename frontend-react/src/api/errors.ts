/** Normalized error shape every API consumer can rely on. */
export class ApiError extends Error {
  /** HTTP status, or 0 for network/unknown errors. */
  readonly status: number
  /** Machine-readable code when the backend provides one. */
  readonly code?: string
  /** Raw response body, if any. */
  readonly data?: unknown

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.data = data
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }
  get isForbidden(): boolean {
    return this.status === 403
  }
}
