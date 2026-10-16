import { HttpError, json, readJson } from "../../_lib.js";
import { requireAccount, userRpc } from "../../_auth.js";
import { validUuid } from "../../_clans.js";
import { hash, randomToken } from "../../_tiktok.js";

export async function onRequestGet({ request, env }) {
  const { token } = await requireAccount(request, env);
  return json(await userRpc(env, token, "rel_clans", { p_action: "status" }));
}
export async function onRequestPost({ request, env }) {
  const { token } = await requireAccount(request, env),
    body = await readJson(request, 2000);
  if (
    ![
      "create",
      "update",
      "invite",
      "revoke_invite",
      "join",
      "leave",
      "remove",
      "disband",
    ].includes(body.action)
  )
    throw new HttpError(400, "Choose a clan action.");
  const args = { p_action: body.action };
  if (["create", "update"].includes(body.action)) {
    if (
      typeof body.name !== "string" ||
      body.name.trim().length < 3 ||
      body.name.trim().length > 50 ||
      typeof body.prefix !== "string" ||
      !/^[A-Za-z0-9]{4}$/.test(body.prefix)
    )
      throw new HttpError(
        400,
        "Use a clan name of 3 to 50 characters and a prefix of exactly four letters or numbers.",
      );
    args.p_name = body.name.trim();
    args.p_prefix = body.prefix.toUpperCase();
  }
  if (
    ["update", "invite", "revoke_invite", "remove", "disband"].includes(
      body.action,
    )
  ) {
    if (!validUuid(body.clanId)) throw new HttpError(400, "Choose a clan.");
    args.p_clan = body.clanId;
  }
  if (body.action === "remove") {
    if (!validUuid(body.memberId))
      throw new HttpError(400, "Choose a clan member.");
    args.p_member = body.memberId;
  }
  let invite;
  if (body.action === "invite") {
    invite = randomToken();
    args.p_invite_hash = await hash(invite);
  }
  if (body.action === "join") {
    if (
      typeof body.invite !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.invite)
    )
      throw new HttpError(400, "Invalid clan invitation.");
    args.p_invite_hash = await hash(body.invite);
  }
  const result = await userRpc(env, token, "rel_clans", args);
  return json({
    ...result,
    ...(invite
      ? { inviteUrl: new URL("/clans/#invite=" + invite, request.url).href }
      : {}),
  });
}
