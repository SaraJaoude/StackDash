import { API_ENDPOINTS } from "@/lib/api/endpoints";
import { apiGet } from "@/lib/api/route";

// GET /api/v1/projects: the workspace's projects. See src/lib/api/route.ts and docs/api.md.
export const GET = apiGet(API_ENDPOINTS.projects);
