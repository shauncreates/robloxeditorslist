import { deliverApplicationEmails } from "../functions/_application-email.js";
import {maintainYoutube} from "../functions/_youtube.js";

export default {
  scheduled(_event, env, context) {
    context.waitUntil(deliverApplicationEmails(env, null, 5));
    context.waitUntil(maintainYoutube(env));
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
