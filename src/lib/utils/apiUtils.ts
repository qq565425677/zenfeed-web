import { get } from "svelte/store";
import { apiUrl } from "$lib/stores/apiUrl";

/**
 * Determines the appropriate API URL to use for a fetch request.
 *
 * Always use the server-side proxy `/api/...` and pass the backend target
 * through `backendUrl`. This avoids browser direct calls to backend and
 * prevents CORS issues in dev/prod.
 *
 * @param endpointPath The specific API endpoint path (e.g., '/query_config'). MUST start with a slash '/'.
 * @returns The proxy URL string to use for fetch request.
 */
export function getTargetApiUrl(endpointPath: string): string {
    const actualBackendUrl = get(apiUrl); // Get the current configured backend URL
    const cleanEndpointPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    return `/api${cleanEndpointPath}?backendUrl=${encodeURIComponent(actualBackendUrl)}`;
}
