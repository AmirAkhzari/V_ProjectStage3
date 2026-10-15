import { describe, expect, it } from 'vitest';
import { generateRequestId } from '../../src/platform/http/requestContext.js';

function req(header: string | string[] | undefined) {
  return { headers: { 'x-request-id': header } };
}

describe('generateRequestId', () => {
  it('accepts a well-formed inbound id', () => {
    expect(generateRequestId(req('req-12345678'))).toBe('req-12345678');
  });

  it('rejects inbound ids with whitespace or control characters', () => {
    const generated = generateRequestId(req('req-12345678\nSet-Cookie: x'));
    expect(generated).not.toContain('\n');
    expect(generated).not.toBe('req-12345678\nSet-Cookie: x');
  });

  it('rejects header arrays', () => {
    const generated = generateRequestId(req(['a', 'b']));
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
