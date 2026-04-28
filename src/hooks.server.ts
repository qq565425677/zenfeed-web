import type { Handle } from "@sveltejs/kit";
import {
    getWebAccessCookieSecret,
    isWebAccessCookieValid,
    webAccessCookieName,
} from "$lib/server/advancedAuth";

export const handle: Handle = async ({ event, resolve }) => {
    const path = event.url.pathname;
    const isAuthEndpoint = path.startsWith("/api/web-auth");
    const isRootPage = path === "/";
    const isUnlocked = isWebAccessCookieValid(
        event.cookies.get(webAccessCookieName),
        getWebAccessCookieSecret(),
        Math.floor(Date.now() / 1000),
    );

    if (isAuthEndpoint || isRootPage || isUnlocked) {
        return resolve(event);
    }

    if (path.startsWith("/api/")) {
        return new Response("Forbidden: Web access is locked.", { status: 403 });
    }

    return new Response(null, {
        status: 303,
        headers: {
            Location: "/",
        },
    });
};
