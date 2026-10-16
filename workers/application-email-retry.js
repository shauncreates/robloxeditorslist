import { deliverApplicationEmails } from "../functions/_application-email.js";

export default {
  scheduled(_event, env, context) {
    context.waitUntil(deliverApplicationEmails(env, null, 5));
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
