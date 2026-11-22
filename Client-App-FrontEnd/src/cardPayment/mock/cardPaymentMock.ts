// shape: v1.2.1-draft@2026-11-22
import { asFullAccount, asMaskedAccount, registerCardPaymentCleaner, type CardPaymentApi, type CardPaymentSnapshot } from "../model";
import { SLICE_F_MOCK_MARKER, TEST_BANK, TEST_HOLDER, TEST_PAN, TEST_PAN_MASKED } from "./fixtures";

void SLICE_F_MOCK_MARKER;
const byId = new Map<string, CardPaymentSnapshot>();
const byKey = new Map<string, CardPaymentSnapshot>();

export function testPayment(over: Partial<CardPaymentSnapshot> = {}): CardPaymentSnapshot {
  return {
    id: "TEST_pay", amount: 125_000, status: "pending", reject_reason: null,
    deadline_at: "2099-01-01T08:30:00.000Z", sla_due_at: "2099-01-02T08:30:00.000Z", cool_down_ends_at: null,
    destination: { full_account: asFullAccount(TEST_PAN), masked_account: asMaskedAccount(TEST_PAN_MASKED), holder_name: TEST_HOLDER, bank_name: TEST_BANK },
    ...over,
  };
}

function seed(id: string) {
  const row = byId.get(id) ?? testPayment({ id });
  byId.set(id, row);
  return row;
}

export const cardPaymentMock: CardPaymentApi = {
  async getPayment(id) { return seed(id); },
  async submitReceipt(id, _body, idempotencyKey) {
    const replay = byKey.get(idempotencyKey);
    if (replay) return replay;
    const next = { ...seed(id), status: "pending_verification" };
    byId.set(id, next);
    byKey.set(idempotencyKey, next);
    return next;
  },
};

registerCardPaymentCleaner(() => { byId.clear(); byKey.clear(); });
