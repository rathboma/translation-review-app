import type { Env } from "../../server/env.ts";
import { pageHandler } from "../../server/pages.ts";

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => pageHandler(request, env);
