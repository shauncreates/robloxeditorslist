const $ = selector => document.querySelector(selector);
const fragment = new URLSearchParams(location.hash.slice(1)), query = new URLSearchParams(location.search);
const token = fragment.get("access_token"), failed = fragment.has("error") || fragment.has("error_code") || query.has("error") || query.has("error_code");
// Remove confirmation tokens before making requests or following another link.
history.replaceState(null, "", "/email-verified/");
window.addEventListener("hashchange", () => location.reload());

async function checkConfirmation() {
  try {
    if (failed) throw new Error("This confirmation link is invalid or expired. Use your latest email link, or sign in if you have already confirmed.");
    if (!token) throw new Error("Open the confirmation link from your signup email, then return here to sign in.");
    const response = await fetch("/api/auth/confirmation", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: token }),
    });
    const result = await response.json();
    if (!response.ok || result.verified !== true) throw new Error(result.error || "Could not check your email confirmation. Try signing in.");
    $("#title").textContent = "Email verified";
    $("#message").textContent = "Your email address is verified. Go back to the sign-in page and sign in with your email and password.";
    document.title = "Email verified | Roblox Editors";
  } catch (error) {
    $("#title").textContent = "Email confirmation";
    $("#message").textContent = error.message;
  } finally { $("#confirmation").setAttribute("aria-busy", "false"); }
}

checkConfirmation();
