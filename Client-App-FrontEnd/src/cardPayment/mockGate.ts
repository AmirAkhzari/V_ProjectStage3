export function assertProductionMockOff(mode: string, flag: string | undefined) {
  if (mode === "production" && flag === "1") {
    throw new Error("VITE_CARD_PAYMENTS_MOCK cannot be enabled for a production build");
  }
}
