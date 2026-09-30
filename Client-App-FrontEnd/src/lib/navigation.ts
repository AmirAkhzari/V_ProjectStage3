import type { NavigateFunction } from "react-router-dom";

export function goBack(navigate: NavigateFunction, fallback = "/") {
  if (typeof window !== "undefined" && (window.history.state?.idx ?? 0) > 0) {
    navigate(-1);
    return;
  }
  navigate(fallback);
}
