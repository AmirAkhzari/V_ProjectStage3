import { mockApi } from "./mockApi";
import { httpApi } from "./httpApi";
import type { DriverApi } from "./api";

export const isMockMode = import.meta.env.VITE_API_MODE !== "http";

export const api: DriverApi = isMockMode ? mockApi : httpApi;
