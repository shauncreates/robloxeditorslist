import { HttpError, json } from "../_lib.js";
import { publicProfileRpc } from "../_public-profiles.js";
import {configured,exchangeRpc} from "../_tiktok.js";
import {youtubeConfig} from "../_youtube.js";
import {clanRpc} from "../_clans.js";

export async function onRequestGet({ request, env }) {
  const params = [...new URL(request.url).searchParams];
  if (params.length !== 1) throw new HttpError(400, "Choose one account, editor or contributor profile.");
  const [kind, id] = params[0];
  const valid = {
    account: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    editor: /^[A-Za-z0-9_-]{1,120}$/, contributor: /^[a-z0-9-]{1,60}$/,
  };
  if (!Object.hasOwn(valid, kind) || !valid[kind].test(id)) throw new HttpError(400, "Invalid profile link.");
  const profile=await publicProfileRpc(env, "rel_public_profile", { ["p_" + (kind === "contributor" ? "credit" : kind)]: id });
  if(profile.account?.id&&configured(env,request))profile.tiktok=await exchangeRpc(env,{p_action:"public",p_account_id:profile.account.id});
  let youtubeAvailable=false;
  try{youtubeConfig(env,request);youtubeAvailable=true}catch{}
  if(profile.account?.id&&youtubeAvailable)profile.youtube=await publicProfileRpc(env,"rel_public_youtube",{p_account:profile.account.id});
  profile.clan=profile.account?.id?await clanRpc(env,"rel_public_account_clan",{p_account:profile.account.id}):null;
  return json(profile);
}
