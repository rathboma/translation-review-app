// Anything else under /api is a JSON error, not the frontend's index.html.
import { fail } from "../../server/http.ts";

export const onRequest: PagesFunction = ({ request }) => {
  const known = ["/api/manifest", "/api/page", "/api/submit"].includes(new URL(request.url).pathname);
  return known ? fail(405, "Method not allowed.", {}, { allow: new URL(request.url).pathname === "/api/submit" ? "POST" : "GET" }) : fail(404, "Not found.");
};
