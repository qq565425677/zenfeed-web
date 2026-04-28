import { json } from "@sveltejs/kit";
import {
    buildWebAccessCookieValue,
    getWebAccessCookieSecret,
    getWebAccessSessionMaxAgeSeconds,
    isWebAccessCookieValid,
    verifyWebAccessTotpCode,
    webAccessCookieName,
} from "$lib/server/advancedAuth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ cookies }) => {
    const unlocked = isWebAccessCookieValid(
        cookies.get(webAccessCookieName),
        getWebAccessCookieSecret(),
        Math.floor(Date.now() / 1000),
    );

    return json({ required: true, unlocked });
};

export const POST: RequestHandler = async ({ request, cookies, url }) => {
    let code = "";
    try {
        const body = await request.json();
        code = typeof body?.code === "string" ? body.code : "";
    } catch {
        code = "";
    }

    if (!verifyWebAccessTotpCode(code, Math.floor(Date.now() / 1000))) {
        return json(
            { ok: false, message: "invalid code" },
            { status: 401 },
        );
    }

    const sessionMaxAgeSeconds = getWebAccessSessionMaxAgeSeconds();
    const nowUnix = Math.floor(Date.now() / 1000);
    const cookieValue = buildWebAccessCookieValue(
        getWebAccessCookieSecret(),
        nowUnix,
        sessionMaxAgeSeconds,
    );

    cookies.set(webAccessCookieName, cookieValue, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: url.protocol === "https:",
        maxAge: sessionMaxAgeSeconds,
    });

    return json({ ok: true, required: true, unlocked: true });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
    cookies.delete(webAccessCookieName, { path: "/" });

    return json({ ok: true });
};
