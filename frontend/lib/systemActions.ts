/**
 * Desktop-only bridge for Phase 6c allowlisted system actions.
 * Absent in plain browser / found3ry.com web deployments.
 */

export type SystemActionResult = {
  success: boolean
  detail: string
}

type FoundrySystemActionsApi = {
  execute: (action: string, target?: string | null) => Promise<SystemActionResult>
}

declare global {
  interface Window {
    foundrySystemActions?: FoundrySystemActionsApi
  }
}

export function isSystemActionsAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.foundrySystemActions?.execute
}

export async function runSystemAction(
  action: string,
  target?: string | null,
): Promise<SystemActionResult> {
  if (!isSystemActionsAvailable()) {
    return {
      success: false,
      detail: 'not available outside the desktop app',
    }
  }
  return window.foundrySystemActions!.execute(action, target ?? undefined)
}
