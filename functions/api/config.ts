import type { Env } from "../../server/env.ts";
import { configHandler } from "../../server/pages.ts";

export const onRequestGet: PagesFunction<Env> = ({ env }) => configHandler(env);
