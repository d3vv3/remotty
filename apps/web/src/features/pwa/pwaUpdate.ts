export const UNKNOWN_PWA_BUILD = "Unknown"

export type PwaUpdateResult =
  | { status: "reloading" }
  | { status: "stalled" }
  | { status: "error"; error: unknown }

export interface PwaUpdateCoordinatorDependencies {
  updateServiceWorker: (reloadPage?: boolean) => Promise<unknown> | unknown
  serviceWorker: {
    controller: unknown
    addEventListener: (type: "controllerchange", listener: EventListener) => void
    removeEventListener: (type: "controllerchange", listener: EventListener) => void
    getRegistration: () => Promise<{ waiting?: { postMessage: (message: { type: "SKIP_WAITING" }) => void } | null } | undefined>
  }
  reload: () => void
  timeoutMs?: number
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

const controllerChangeTimeoutMs = 4_500

export const activatePwaUpdate = async ({
  updateServiceWorker,
  serviceWorker,
  reload,
  timeoutMs = controllerChangeTimeoutMs,
  setTimeout: schedule = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout,
}: PwaUpdateCoordinatorDependencies): Promise<PwaUpdateResult> => {
  const initialController = serviceWorker.controller
  let controllerChangeObserved = false
  const controllerChanged = () => controllerChangeObserved || serviceWorker.controller !== initialController
  const onControllerChange: EventListener = () => { controllerChangeObserved = serviceWorker.controller !== initialController }
  serviceWorker.addEventListener("controllerchange", onControllerChange)

  const waitForControllerChange = () => {
    let cancelWait: () => void = () => {}
    const promise = new Promise<boolean>((resolve) => {
      if (controllerChanged()) {
        resolve(true)
        return
      }
      let settled = false
      let timer: ReturnType<typeof schedule>
      const finish = (changed: boolean) => {
        if (settled) return
        settled = true
        cancel(timer)
        serviceWorker.removeEventListener("controllerchange", check)
        resolve(changed)
      }
      const check = () => {
        if (controllerChanged()) finish(true)
      }
      serviceWorker.addEventListener("controllerchange", check)
      timer = schedule(() => finish(controllerChanged()), timeoutMs)
      cancelWait = () => finish(false)
      if (controllerChanged()) finish(true)
    })
    return { promise, cancel: cancelWait }
  }

  const reloadIfChanged = () => {
    if (!controllerChanged()) return false
    reload()
    return true
  }

  try {
    const update = Promise.resolve()
      .then(() => updateServiceWorker(false))
      .then(() => ({ type: "complete" as const }), (error) => ({ type: "error" as const, error }))
    const firstWait = waitForControllerChange()
    const firstResult = await Promise.race([
      update,
      firstWait.promise.then((changed) => ({ type: "timeout" as const, changed })),
    ])
    if (reloadIfChanged()) {
      firstWait.cancel()
      return { status: "reloading" }
    }
    if (firstResult.type === "error") {
      firstWait.cancel()
      return { status: "error", error: firstResult.error }
    }
    if (firstResult.type === "complete" && await firstWait.promise && reloadIfChanged()) return { status: "reloading" }
    firstWait.cancel()
    if (reloadIfChanged()) return { status: "reloading" }

    const registration = Promise.resolve()
      .then(() => serviceWorker.getRegistration())
      .then((value) => ({ type: "complete" as const, value }), (error) => ({ type: "error" as const, error }))
    const registrationWait = waitForControllerChange()
    const registrationResult = await Promise.race([
      registration,
      registrationWait.promise.then((changed) => ({ type: "timeout" as const, changed })),
    ])
    if (registrationResult.type !== "timeout") registrationWait.cancel()
    if (reloadIfChanged()) return { status: "reloading" }
    if (registrationResult.type === "error") {
      registrationWait.cancel()
      return { status: "error", error: registrationResult.error }
    }
    if (registrationResult.type === "timeout") return { status: "stalled" }
    if (reloadIfChanged()) return { status: "reloading" }

    const waiting = registrationResult.value?.waiting
    if (!waiting) return { status: "stalled" }
    waiting.postMessage({ type: "SKIP_WAITING" })
    const secondWait = waitForControllerChange()
    if (await secondWait.promise && reloadIfChanged()) return { status: "reloading" }
    secondWait.cancel()
    if (reloadIfChanged()) return { status: "reloading" }
    return { status: "stalled" }
  } catch (error) {
    return { status: "error", error }
  } finally {
    serviceWorker.removeEventListener("controllerchange", onControllerChange)
  }
}

export const shouldShowPwaUpdate = (needRefresh: boolean, pathname: string, paired: boolean): boolean => (
  needRefresh && pathname !== "/pair" && (pathname === "/app" || paired)
)

export const pwaBuildFromModuleScriptUrls = (scriptUrls: Iterable<string>, origin: string): string => {
  let currentOrigin: string
  try {
    currentOrigin = new URL(origin).origin
  } catch {
    return UNKNOWN_PWA_BUILD
  }

  for (const scriptUrl of scriptUrls) {
    try {
      const url = new URL(scriptUrl, currentOrigin)
      const filename = url.pathname.split("/").at(-1)
      if (url.origin === currentOrigin && filename && /^index-[A-Za-z0-9_-]+\.js$/.test(filename)) return filename
    } catch {
      continue
    }
  }

  return UNKNOWN_PWA_BUILD
}
