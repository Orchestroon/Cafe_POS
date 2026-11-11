import { request, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { authFile, PASSWORD, ROLES } from "./helpers";

/** Log in once per demo user and keep the session (login is rate limited to 10/min per IP). */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  mkdirSync(new URL("./.auth/", import.meta.url).pathname, { recursive: true });
  for (const user of ROLES) {
    const ctx = await request.newContext({ baseURL });
    await ctx.get("/api/v1/auth/csrf");
    const csrf = (await ctx.storageState()).cookies.find((c) => c.name === "csrftoken")?.value ?? "";
    const r = await ctx.post("/api/v1/auth/login", { data: { username: user, password: PASSWORD }, headers: { "X-CSRFToken": csrf } });
    if (!r.ok()) throw new Error(`login ${user}: ${r.status()} ${await r.text()}`);
    await ctx.storageState({ path: authFile(user) });
    await ctx.dispose();
  }
}
