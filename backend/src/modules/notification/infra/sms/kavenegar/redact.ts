/** Strip the API key from Kavenegar path URLs and drop code/phone from text. */
export function redactSmsSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join('[REDACTED]');
  }
  return out.replace(/\+989[0-9]{9}/g, '[REDACTED]').replace(/\b[0-9]{6}\b/g, '[REDACTED]');
}
