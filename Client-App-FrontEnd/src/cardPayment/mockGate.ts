export function assertProductionMockOff(command: string, mode: string, flag: string | undefined) {
  if (flag === "1" && (command === "build" || mode !== "development")) {
    throw new Error("VITE_CARD_PAYMENTS_MOCK cannot be enabled for a non-development build");
  }
}
