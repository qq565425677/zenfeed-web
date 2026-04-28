import { env as privateEnv } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import { timingSafeEqual } from "crypto";
import {
    buildWebAccessCookieValue,
    isWebAccessCookieValid,
    webAccessCookieName,
} from "$lib/server/advancedAuth";
import type { RequestHandler } from "./$types";

const webAccessPassword =
    privateEnv.ZENFEED_WEB_ACCESS_PASSWORD || "";
const webAccessAuthSecret =
    privateEnv.ZENFEED_WEB_ACCESS_SECRET || webAccessPassword;
const cookieMaxAgeSeconds = 8 * 60 * 60;

function equalInConstantTime(a: string, b: string): boolean {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) {
        return false;
    }

    return timingSafeEqual(left, right);
}

export const GET: RequestHandler = async ({ cookies }) => {
    const required = webAccessPassword !== "";
    const unlocked =
        !required ||
        isWebAccessCookieValid(
            cookies.get(webAccessCookieName),
            webAccessAuthSecret,
            Math.floor(Date.now() / 1000),
        );

    return json({ required, unlocked });
};

export const POST: RequestHandler = async ({ request, cookies, url }) => {
    if (webAccessPassword === "") {
        return json({ ok: true, required: false, unlocked: true });
    }

    let password = "";
    try {
        const body = await request.json();
        password = typeof body?.password === "string" ? body.password : "";
    } catch {
        password = "";
    }

    if (!equalInConstantTime(password, webAccessPassword)) {
        return json(
            { ok: false, message: "invalid password" },
            { status: 401 },
        );
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    const cookieValue = buildWebAccessCookieValue(
        webAccessAuthSecret,
        nowUnix,
        cookieMaxAgeSeconds,
    );

    cookies.set(webAccessCookieName, cookieValue, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: url.protocol === "https:",
        maxAge: cookieMaxAgeSeconds,
    });

    return json({ ok: true, required: true, unlocked: true });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
    cookies.delete(webAccessCookieName, { path: "/" });

    return json({ ok: true });
};
