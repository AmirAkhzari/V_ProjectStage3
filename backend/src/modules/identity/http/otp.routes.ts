import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { IRAN_MOBILE_RE, type OtpPurpose } from '../../notification/api.js';
import { sendOtp, type OtpAuthRuntime } from '../application/otpAuth.js';

const phone = z.string().regex(IRAN_MOBILE_RE);
const sendBody = z.object({ phone }).strict();
const sendResponse = z
  .object({
    status: z.literal('sent'),
    expiresInSeconds: z.number().int().min(1).max(120),
    resendAfterSeconds: z.number().int().min(60),
  })
  .strict();

function runtimeOf(app: { otpAuth?: OtpAuthRuntime }): OtpAuthRuntime {
  if (!app.otpAuth) {
    throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
      retryAfter: 5,
    });
  }
  return app.otpAuth;
}

export function otpRoutePlugin(
  purpose: OtpPurpose,
  ops: { send: 'A1' | 'B1' },
): FastifyPluginAsync {
  return async (app) => {
    app.post(
      '/auth/otp/send',
      { schema: { operationId: ops.send, body: sendBody } },
      async (request) => {
        const body = request.body as z.infer<typeof sendBody>;
        return sendResponse.parse(
          await sendOtp(runtimeOf(app), { purpose, phone: body.phone, ip: request.ip }),
        );
      },
    );
  };
}
