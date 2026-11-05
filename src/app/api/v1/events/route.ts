import { API_ENDPOINTS } from "@/lib/api/endpoints";
import { apiGet } from "@/lib/api/route";

// GET /api/v1/events: timeline events (events:read). See src/lib/api/route.ts and docs/api.md.
export const GET = apiGet(API_ENDPOINTS.events);
