const credentialPattern = /^[A-Za-z0-9_-]{32,128}$/

export const pairingCredentialFrom = (value: string) => {
  const input = value.trim()
  if (credentialPattern.test(input)) return input
  try {
    const code = new URL(input).searchParams.get("code") ?? ""
    return credentialPattern.test(code) ? code : undefined
  } catch {
    return undefined
  }
}
