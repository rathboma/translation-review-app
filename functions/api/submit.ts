import type { Env } from "../../server/env.ts";
import { submitHandler } from "../../server/submit.ts";

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => submitHandler(request, env);
