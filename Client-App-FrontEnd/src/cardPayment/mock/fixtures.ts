// TEST DATA ONLY. Fictional values that belong to no one. Do not replace them with a real card, IBAN, name, or phone.
// PAN is Luhn-valid and uses the unissued 0000 prefix (not a bank BIN).
// IBAN is checksum-valid (ISO 13616) with fictional bank code 000.
// Masked strings are independent server fields. The UI must not derive one from the other.
// shape: v1.2.1-draft@2026-11-22

export const SLICE_F_MOCK_MARKER = "SLICE_F_CARD_PAYMENT_MOCK_v1_2_1";
export const TEST_PAN = "0000123400000006";
export const TEST_IBAN = "IR220000000000000000000001";
export const TEST_PAN_MASKED = "0000••••••••0006";
export const TEST_IBAN_MASKED = "IR22••••••••••••••••0001";
export const TEST_HOLDER = "TEST_دارنده نمونه";
export const TEST_BANK = "TEST_بانک نمونه";
