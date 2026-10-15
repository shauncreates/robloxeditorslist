import { json } from "../_lib.js";
import { publicProfileRpc } from "../_public-profiles.js";

export async function onRequestGet({ env }) {
  return json(await publicProfileRpc(env, "rel_public_contributors"));
}
