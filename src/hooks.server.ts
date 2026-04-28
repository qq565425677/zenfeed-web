import { env as privateEnv } from "$env/dynamic/private";
import type { Handle } from "@sveltejs/kit";
import { isWebAccessCookieValid, webAccessCookieName } from "$lib/server/advancedAuth";

const webAccessPassword =
    privateEnv.ZENFEED_WEB_ACCESS_PASSWORD || "";
const webAccessSecret =
    privateEnv.ZENFEED_WEB_ACCESS_SECRET || webAccessPassword;

export const handle: Handle = async ({ event, resolve }) => {
    if (webAccessPassword === "") {
        return resolve(event);
    }

    const path = event.url.pathname;
    const isAuthEndpoint = path.startsWith("/api/web-auth");
    const isRootPage = path === "/";
    const isUnlocked = isWebAccessCookieValid(
        event.cookies.get(webAccessCookieName),
        webAccessSecret,
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
