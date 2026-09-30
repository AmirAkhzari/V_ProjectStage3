import { describe, expect, it } from "vitest";
import { httpApiReachable } from "./http";

describe("httpApiReachable", () => {
  it("stays on mock unless API mode is http", () => {
    expect(httpApiReachable("mock", "https://api.example.com/v1", "https:")).toBe(false);
    expect(httpApiReachable(undefined, "https://api.example.com/v1", "https:")).toBe(false);
  });

  it("allows local http API during local development", () => {
    expect(httpApiReachable("http", "http://localhost:8787/v1", "http:")).toBe(true);
  });

  it("does not call localhost HTTP from a HTTPS deploy", () => {
    expect(httpApiReachable("http", "http://localhost:8787/v1", "https:")).toBe(false);
    expect(httpApiReachable("http", "http://127.0.0.1:8787/v1", "https:")).toBe(false);
  });

  it("keeps a public HTTPS API in http mode", () => {
    expect(httpApiReachable("http", "https://api.example.com/v1", "https:")).toBe(true);
  });
});
