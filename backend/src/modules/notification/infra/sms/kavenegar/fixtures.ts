/** Recorded Kavenegar verify/lookup bodies. CI never hits the network. */
function envelope(status: number, message: string, extra: object = {}): string {
  return JSON.stringify({ return: { status, message }, ...extra });
}

export const KAVENEGAR_FIXTURES = {
  success: envelope(200, 'OK', { entries: [{ messageid: 8792341, statustext: 'sent' }] }),
  receptor411: envelope(411, 'invalid receptor'),
  key401: envelope(401, 'account inactive'),
  key403: envelope(403, 'invalid api key'),
  credit418: envelope(418, 'insufficient credit'),
  template424: envelope(424, 'template not found'),
  template426: envelope(426, 'advanced plan required'),
  timeout408: envelope(408, 'request timeout'),
  rate429: envelope(429, 'ip rate limited'),
  clientError: envelope(411, 'invalid receptor'),
  serverError: envelope(500, 'upstream unavailable'),
  malformed: '<<<not-json>>>',
  oversized: `${'x'.repeat(9000)}`,
} as const;
