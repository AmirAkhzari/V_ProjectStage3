import { mockApi } from "./mockApi";
import { httpApi } from "./httpApi";
import type { AdminApi } from "./api";

export const api: AdminApi = import.meta.env.VITE_API_MODE === "http" ? httpApi : mockApi;
