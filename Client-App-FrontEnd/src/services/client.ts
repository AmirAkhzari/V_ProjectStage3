import { mockApi } from "./mockApi";
import { httpApi } from "./httpApi";
import type { VisitorApi } from "./api";
import { shouldUseHttpApi } from "./http";

export const api: VisitorApi = shouldUseHttpApi() ? httpApi : mockApi;
