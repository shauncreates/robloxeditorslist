const $ = selector => document.querySelector(selector), form = $("#resetForm");
let recovering = false, busy = false;

function setRecovery(value) {
  recovering = value;
  $("#recoveryFields").hidden = !value;
  $("#recoveryFields").disabled = !value;
  $("#recoveryActions").hidden = !value;
  $("#haveCode").hidden = value;
  $("#email").readOnly = value;
  $("#submit").textContent = value ? "Reset password" : "Send recovery code";
  $("#intro").textContent = value ? "Enter your recovery code and choose a new password." : "Enter your account email to request a recovery code.";
}

async function submit(resend = false) {
  if (busy || !(resend ? $("#email").reportValidity() : form.reportValidity())) return;
  if (recovering && !resend && $("#password").value !== $("#confirmPassword").value) {
    $("#message").textContent = "The passwords do not match.";
    $("#confirmPassword").focus();
    return;
  }
  const resetting = recovering && !resend;
  busy = true;
  for (const selector of ["#submit", "#resend", "#changeEmail", "#haveCode"]) $(selector).disabled = true;
  $("#email").readOnly = true;
  form.setAttribute("aria-busy", "true");
  $("#message").textContent = resetting ? "Changing your password…" : "Requesting a recovery code…";
  const body = { email: $("#email").value.trim() };
  if (resetting) Object.assign(body, { code: $("#code").value, password: $("#password").value, confirmPassword: $("#confirmPassword").value });
  try {
    const response = await fetch(resetting ? "/api/auth/reset-password" : "/api/auth/forgot-password", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Please try again.");
    $("#message").textContent = result.message;
    if (resetting) {
      form.hidden = true;
      $("#recoveryActions").hidden = true;
      $("#intro").textContent = "Your password has been updated.";
      $("#password").value = "";
      $("#confirmPassword").value = "";
      $("#code").value = "";
    } else {
      setRecovery(true);
      $("#code").value = "";
      $("#code").focus();
    }
  } catch (error) { $("#message").textContent = error.message; }
  finally {
    busy = false;
    $("#email").readOnly = recovering;
    for (const selector of ["#submit", "#resend", "#changeEmail", "#haveCode"]) $(selector).disabled = false;
    form.removeAttribute("aria-busy");
  }
}

form.addEventListener("submit", event => { event.preventDefault(); submit(); });
$("#haveCode").addEventListener("click", () => {
  if (busy || !$("#email").reportValidity()) return;
  setRecovery(true);
  $("#code").focus();
});
$("#resend").addEventListener("click", () => submit(true));
$("#changeEmail").addEventListener("click", () => {
  if (busy) return;
  for (const selector of ["#code", "#password", "#confirmPassword"]) $(selector).value = "";
  $("#message").textContent = "";
  setRecovery(false);
  $("#email").focus();
});
