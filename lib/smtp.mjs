const fields = ['from_email', 'from_name', 'smtp_host', 'smtp_port', 'encryption', 'smtp_username', 'smtp_password', 'smtp_authentication']
export function validateSMTP(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('SMTP configuration must be a JSON object')
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Unknown SMTP configuration field')
  for (const key of fields.filter(key => !['smtp_port', 'smtp_authentication'].includes(key))) {
    if (typeof input[key] !== 'string' || !input[key] || input[key].length > 256 || /[\r\n\0]/.test(input[key])) throw new Error(`Invalid SMTP field: ${key}`)
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.from_email)) throw new Error('Invalid sender email')
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(input.smtp_host)) throw new Error('SMTP host must be a hostname without a scheme or port')
  if (!Number.isInteger(input.smtp_port) || input.smtp_port < 1 || input.smtp_port > 65535) throw new Error('Invalid SMTP port')
  if (!['SSL', 'TLS'].includes(input.encryption)) throw new Error('Encrypted SMTP is required')
  if (input.smtp_authentication !== true) throw new Error('SMTP authentication is required')
  if (/^\*+$/.test(input.smtp_password)) throw new Error('A real client authorization password is required')
  return Object.fromEntries(fields.map(key => [key, input[key]]))
}
