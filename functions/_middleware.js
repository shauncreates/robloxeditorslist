import { secureResponse } from "./_security.js";

export async function onRequest({ next }) {
  return secureResponse(await next());
}
