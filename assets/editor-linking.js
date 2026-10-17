export function applicationIdentityText(check) {
  return {
    verified: "TikTok ownership matched when this application was submitted. REL checks the match again when the editor is added.",
    not_connected: "No active TikTok connection was available when this application was submitted.",
    different_profile: "The submitted TikTok profile did not match the applicant's connected account.",
    not_tiktok: "",
    unavailable: "TikTok ownership was not checked for this application.",
  }[check?.status] ?? "TikTok ownership was not checked for this application.";
}

export function applicationLinkingNotice(check) {
  return {
    verified: "Your verified TikTok matches this application. Your REL account will link automatically when the approved editor is added, provided the match is still valid and the profile is unclaimed.",
    not_connected: "Connect TikTok in My account to verify your profile before it is added to the list. Owner-reviewed linking is also available.",
    different_profile: "Your connected TikTok does not match the submitted profile. Linking will need Owner review unless you connect the matching account.",
  }[check?.status] || "";
}
