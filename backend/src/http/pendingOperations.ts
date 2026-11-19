/**
 * Slice 1b + slice 2 + slice 3a + slice 3b + slice 3e + slice 3f: the 116 frozen v1.2.0 operations that are neither LIVE nor the five
 * UNREGISTERED_IN_PROD ops (A5, A35, B5, B79, B80). They have registry rows but stay
 * unregistered, so the group catch-all returns the byte-identical 404. No 501 stubs.
 *
 * Composition-level (not platform): this is the counted PENDING list the coverage test
 * asserts. Depth is 3 rather than a Set for a readable, frozen source of truth.
 */
// prettier-ignore
export const PENDING_OPERATION_IDS: readonly string[] = Object.freeze([
  'A6', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A23', 'A24', 'A25', 'A26', 'A27', 'A28', 'A29', 'A30', 'A31', 'A32', 'A33', 'A34', 'A36', 'A37', 'A38', 'A39', 'A40', 'A41', 'A42',
  'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'B21', 'B22', 'B23', 'B26', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B37', 'B38', 'B39', 'B40', 'B41', 'B42', 'B43', 'B44', 'B45', 'B46', 'B47', 'B48', 'B49', 'B50', 'B51', 'B52', 'B53', 'B54', 'B55', 'B56', 'B57', 'B58', 'B59', 'B60', 'B61', 'B62', 'B63', 'B64', 'B65', 'B66', 'B67', 'B68', 'B69', 'B70', 'B71', 'B72', 'B73', 'B74', 'B75', 'B76', 'B77', 'B78', 'B81', 'B82',
  'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10',
  'S3',
]);

export const PENDING_OPERATION_ID_SET: ReadonlySet<string> = new Set(PENDING_OPERATION_IDS);
