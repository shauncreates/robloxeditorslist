import { HttpError, json } from "../_lib.js";

export async function onRequest({ request, next }) {
  try {
    // HttpOnly cookies require CSRF protection, including login and logout.
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.headers.get("origin") !== new URL(request.url).origin ||
          request.headers.get("sec-fetch-site") === "cross-site") {
        throw new HttpError(403, "Use this website to submit requests.");
      }
    }
    return await next();
  } catch (error) {
    return json({ error: error instanceof HttpError ? error.message : "Service temporarily unavailable." },
      error instanceof HttpError ? error.status : 503);
  }
}
