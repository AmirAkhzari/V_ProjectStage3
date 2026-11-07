import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { IRAN_MOBILE_RE, OTP_CODE_RE, type OtpPurpose } from '../../notification/api.js';
import {
  sendOtp,
  verifyAppOtp,
  verifyStaffOtp,
  type OtpAuthRuntime,
} from '../application/otpAuth.js';

const phone = z.string().regex(IRAN_MOBILE_RE);
const sendBody = z.object({ phone }).strict();
const verifyBody = z.object({ phone, code: z.string().regex(OTP_CODE_RE) }).strict();
const sendResponse = z
  .object({
    status: z.literal('sent'),
    expiresInSeconds: z.number().int().min(1).max(120),
    resendAfterSeconds: z.number().int().min(60),
  })
  .strict();
const tokenFields = {
  accessToken: z.string().min(1).max(4096),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string().min(43).max(512),
  refreshExpiresAt: z.string().datetime(),
  absoluteExpiresAt: z.string().datetime(),
  tokenType: z.literal('Bearer'),
};
const shopkeeperSession = z
  .object({
    ...tokenFields,
    user: z.object({ id: z.string().uuid(), phone, isNewAccount: z.boolean() }).strict(),
  })
  .strict();
const staffSession = z
  .object({
    ...tokenFields,
    staff: z
      .object({
        id: z.string().uuid(),
        phone,
        role: z.enum(['super_admin', 'distributor_admin']),
        distributorId: z.string().uuid().nullable(),
        permissions: z
          .array(
            z
              .string()
              .regex(/^[a-z_]+\.[a-z_]+$/)
              .max(64),
          )
          .max(64),
      })
      .strict(),
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
  ops: { send: 'A1' | 'B1'; verify: 'A2' | 'B2' },
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
    app.post(
      '/auth/otp/verify',
      { schema: { operationId: ops.verify, body: verifyBody } },
      async (request) => {
        const body = request.body as z.infer<typeof verifyBody>;
        const rt = runtimeOf(app);
        const input = { phone: body.phone, code: body.code, ip: request.ip };
        return purpose === 'app'
          ? shopkeeperSession.parse(await verifyAppOtp(rt, input))
          : staffSession.parse(await verifyStaffOtp(rt, input));
      },
    );
  };
}
