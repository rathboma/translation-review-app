import type { Env } from "../../server/env.ts";
import { manifestHandler } from "../../server/pages.ts";

export const onRequestGet: PagesFunction<Env> = ({ env }) => manifestHandler(env);
