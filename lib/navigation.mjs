export function safeReturnPath(value, origin) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\x00-\x20]/.test(value)) return '/questions/'
  try {
    const target = new URL(value, origin)
    if (target.origin !== new URL(origin).origin || /^\/login(?:\/|$)/.test(target.pathname)) return '/questions/'
    return target.pathname + target.search + target.hash
  } catch { return '/questions/' }
}
