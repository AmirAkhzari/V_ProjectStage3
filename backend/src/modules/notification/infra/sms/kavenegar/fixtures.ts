/** Recorded Kavenegar verify/lookup bodies. CI never hits the network. */
export const KAVENEGAR_FIXTURES = {
  success: JSON.stringify({
    return: { status: 200, message: 'OK' },
    entries: [{ messageid: 8792341, statustext: 'sent' }],
  }),
  clientError: JSON.stringify({
    return: { status: 411, message: 'invalid receptor' },
  }),
  serverError: JSON.stringify({
    return: { status: 500, message: 'upstream unavailable' },
  }),
  malformed: '<<<not-json>>>',
  oversized: `${'x'.repeat(9000)}`,
} as const;
