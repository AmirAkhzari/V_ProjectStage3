import { AppError } from '../../../platform/http/errors.js';

/** Explicit OTP/SMS stub. No Kavenegar in S11b-4a (S11b-5). */
export function otpNotImplemented(): never {
  throw new AppError('NOT_FOUND', 404, 'Resource not found');
}
