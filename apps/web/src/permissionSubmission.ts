export type PermissionResponse = "once" | "always" | "reject"

export interface PermissionSubmissionState {
  permissionId?: string
  pending?: PermissionResponse
  token?: number
}

export const isPermissionRequestNotFoundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /permission\s+request\s+not\s+found/i.test(message)
}

export const createPermissionSubmissionGuard = () => {
  let state: PermissionSubmissionState = {}
  let active = false
  let token = 0

  return {
    activate(permissionId: string) {
      if (!active || state.permissionId !== permissionId) {
        active = true
        token += 1
        state = { permissionId, token }
      }
      return state
    },
    begin(permissionId: string, response: PermissionResponse, requestToken: number) {
      if (!this.isActive(permissionId, requestToken) || state.pending) return false
      state = { permissionId, pending: response, token }
      return true
    },
    isActive(permissionId: string, requestToken: number) {
      return active && state.permissionId === permissionId && token === requestToken
    },
    invalidate(requestToken?: number) {
      if (requestToken === undefined || token === requestToken) active = false
      return state
    },
    unlock(permissionId: string, requestToken: number) {
      if (this.isActive(permissionId, requestToken)) state = { permissionId, token }
      return state
    },
    state() {
      return state
    },
  }
}
