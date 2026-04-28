import { error as skError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import {
    getWebAccessCookieSecret,
    isWebAccessCookieValid,
    webAccessCookieName,
} from '$lib/server/advancedAuth';

const disableApiProxyQueryConfig = env.PUBLIC_DISABLE_API_PROXY_QUERY_CONFIG === "true";
const disableApiProxyApplyConfig = env.PUBLIC_DISABLE_API_PROXY_APPLY_CONFIG === "true";
const protectedApiAuthToken = privateEnv.ZENFEED_API_AUTH_TOKEN || "";
const allowedBackendListRaw =
    privateEnv.ZENFEED_ALLOWED_BACKEND_URLS || "localhost,127.0.0.1,zenfeed";

type AllowedBackends = {
    hosts: Set<string>;
    origins: Set<string>;
};

function parseAllowedBackends(input: string): AllowedBackends {
    const hosts = new Set<string>();
    const origins = new Set<string>();
    const items = input
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);

    for (const item of items) {
        if (item.includes("://")) {
            try {
                const parsed = new URL(item);
                if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                    origins.add(parsed.origin.toLowerCase());
                }
            } catch {
                // Ignore invalid whitelist item.
            }
            continue;
        }
        hosts.add(item.toLowerCase());
    }

    return { hosts, origins };
}

function validateBackendUrl(backendUrl: string, allowed: AllowedBackends): URL {
    let parsed: URL;
    try {
        parsed = new URL(backendUrl);
    } catch {
        throw skError(400, `Bad Request: Invalid backendUrl format: ${backendUrl}`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw skError(400, "Bad Request: backendUrl must use http or https.");
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw skError(400, "Bad Request: backendUrl must be an origin (no path/query/hash).");
    }

    const host = parsed.hostname.toLowerCase();
    const hostWithPort = parsed.host.toLowerCase();
    const origin = parsed.origin.toLowerCase();
    const isAllowed =
        allowed.origins.has(origin) ||
        allowed.hosts.has(host) ||
        allowed.hosts.has(hostWithPort);
    if (!isAllowed) {
        throw skError(
            403,
            `Forbidden: backendUrl host is not in allowlist: ${parsed.host}`,
        );
    }

    return parsed;
}

const allowedBackends = parseAllowedBackends(allowedBackendListRaw);

// This handler will attempt to proxy requests for any method (GET, POST, etc.)
const handler: RequestHandler = async (event) => {
    const { request, params, url, cookies } = event;
    const backendUrl = url.searchParams.get('backendUrl'); // Get backend URL from query parameter

    if (!backendUrl) {
        // It's crucial that the client provides this parameter when using the proxy
        throw skError(400, 'Bad Request: Missing backendUrl query parameter for proxy request.');
    }

    const parsedBackendUrl = validateBackendUrl(backendUrl, allowedBackends);

    // `params.path` will contain the matched path segments after /api/
    const endpointPath = params.path;
    const isProtectedConfigEndpoint =
        endpointPath === "query_config" || endpointPath === "apply_config";

    if (disableApiProxyQueryConfig && endpointPath.startsWith('query_config')) {
        throw skError(404, 'Not Found: Query config endpoint is disabled.');
    }

    if (disableApiProxyApplyConfig && endpointPath.startsWith('apply_config')) {
        throw skError(404, 'Not Found: Apply config endpoint is disabled.');
    }
    if (endpointPath.startsWith("web-auth")) {
        throw skError(404, "Not Found");
    }
    if (!isWebAccessCookieValid(
        cookies.get(webAccessCookieName),
        getWebAccessCookieSecret(),
        Math.floor(Date.now() / 1000),
    )) {
        throw skError(403, "Forbidden: Web access is locked.");
    }

    const targetUrl = `${parsedBackendUrl.origin}/${endpointPath}`;

    console.log(`Proxying ${request.method} request for /api/${endpointPath} to: ${targetUrl}`); // Optional: server-side logging

    try {
        const forwardHeaders = new Headers();
        const contentType = request.headers.get('Content-Type');
        const accept = request.headers.get('Accept');
        if (contentType) {
            forwardHeaders.set('Content-Type', contentType);
        }
        if (accept) {
            forwardHeaders.set('Accept', accept);
        } else {
            forwardHeaders.set('Accept', '*/*');
        }
        // Keep same-origin semantics for backend when disable_cors=true.
        forwardHeaders.set('Origin', parsedBackendUrl.origin);
        if (isProtectedConfigEndpoint && protectedApiAuthToken) {
            forwardHeaders.set('Authorization', `Bearer ${protectedApiAuthToken}`);
        }

        // Forward the request to the backend
        const response = await globalThis.fetch(targetUrl, {
            method: request.method,
            headers: forwardHeaders,
            body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
            duplex: 'half'
        } as RequestInit);

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers)
        });

    } catch (e: any) {
        console.error(`Error proxying /api/${endpointPath}:`, e);
        if (e.cause && e.cause.code) {
            if (e.cause.code === 'ECONNREFUSED') {
                throw skError(503, `Service Unavailable: Could not connect to backend at ${backendUrl}`);
            }
        }
        throw skError(500, `Failed to proxy request to backend: ${e.message || 'Unknown error'}`);
    }
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
