import { env as privateEnv } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import { timingSafeEqual } from "crypto";
import {
    advancedUnlockCookieName,
    buildAdvancedUnlockCookieValue,
    isAdvancedUnlockCookieValid,
} from "$lib/server/advancedAuth";
import type { RequestHandler } from "./$types";

const advancedConfigPassword = privateEnv.ZENFEED_ADVANCED_CONFIG_PASSWORD || "";
const advancedAuthSecret =
    privateEnv.ZENFEED_ADVANCED_AUTH_SECRET || advancedConfigPassword;
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
    const required = advancedConfigPassword !== "";
    const unlocked =
        !required ||
        isAdvancedUnlockCookieValid(
            cookies.get(advancedUnlockCookieName),
            advancedAuthSecret,
            Math.floor(Date.now() / 1000),
        );

    return json({ required, unlocked });
};

export const POST: RequestHandler = async ({ request, cookies, url }) => {
    if (advancedConfigPassword === "") {
        return json({ ok: true, required: false, unlocked: true });
    }

    let password = "";
    try {
        const body = await request.json();
        password = typeof body?.password === "string" ? body.password : "";
    } catch {
        password = "";
    }

    if (!equalInConstantTime(password, advancedConfigPassword)) {
        return json(
            { ok: false, message: "invalid password" },
            { status: 401 },
        );
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    const cookieValue = buildAdvancedUnlockCookieValue(
        advancedAuthSecret,
        nowUnix,
        cookieMaxAgeSeconds,
    );

    cookies.set(advancedUnlockCookieName, cookieValue, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: url.protocol === "https:",
        maxAge: cookieMaxAgeSeconds,
    });

    return json({ ok: true, required: true, unlocked: true });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
    cookies.delete(advancedUnlockCookieName, { path: "/" });

    return json({ ok: true });
};
