import { HttpError } from "../_lib.js";
import { requireAccount } from "../_auth.js";
import { onRequestPost as refreshSession } from "../api/auth/refresh.js";

export async function onRequest({ request, env, next }) {
  try {
    let account, refreshed;
    try { ({account} = await requireAccount(request, env)); }
    catch(error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
      refreshed = await refreshSession({request,env});
      if (!refreshed.ok) throw new HttpError(refreshed.status, "Please sign in again.");
      ({account} = await refreshed.json());
    }
    const cookies = response => {
      if(refreshed){
        const values=typeof refreshed.headers.getSetCookie==="function" ? refreshed.headers.getSetCookie() : refreshed.headers.getAll("Set-Cookie");
        for(const cookie of values)response.headers.append("Set-Cookie",cookie);
      }
      return response;
    };
    if (!account.roles.some(role => ["owner", "list_contributor", "application_reviewer"].includes(role))) {
      return cookies(new Response(null, { status: 302, headers: { Location: new URL("/account/", request.url).href, "Cache-Control": "no-store" } }));
    }
    const upstream = await next();
    const response = new Response(upstream.body, upstream);
    response.headers.set("Cache-Control", "private, no-store");
    return cookies(response);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return new Response(null, { status: 302, headers: { Location: new URL("/signin/", request.url).href, "Cache-Control": "no-store" } });
    }
    return new Response("Account access could not be verified. Please try again.", {
      status: error instanceof HttpError ? error.status : 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
