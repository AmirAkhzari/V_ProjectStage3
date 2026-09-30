import { describe, expect, it } from "vitest";
import L from "leaflet";
import { pinContainerPoint } from "./mapAnchor";

describe("map pin anchor", () => {
  it("places the pin in the visible map above the bottom sheet", () => {
    const point = pinContainerPoint(L.point(390, 720), 200);
    expect(point.x).toBe(195);
    expect(point.y).toBe(260);
  });
});
