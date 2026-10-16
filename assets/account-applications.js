import { accountFetch } from "./account.js";
import { watchChanges } from "./autosave.js";
const root = document.querySelector("#myApplications"),
  esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let offset = 0,
  busy = false,
  total = 0;
async function load() {
  if (busy) return;
  busy = true;
  try {
    const response = await accountFetch(
        "/api/account/applications?offset=" + offset,
      ),
      data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Your applications could not be loaded.");
    total = data.total;
    const cards = data.applications
      .map((app) => {
        const state = app.archived
          ? "Archived"
          : {
              pending: "Pending review",
              approved: "Approved",
              rejected: "Denied",
            }[app.status] || "Pending review";
        const date = new Date(app.created_at).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        return `<article class="application-card"><div class="application-heading"><div><h3>${esc(app.display_name)}</h3><p class="hint">${esc(app.platform)} · ${esc(app.software)} · Submitted ${esc(date)}</p></div><span class="application-state">${state}</span></div>
        <p>${app.archived ? "This application was archived by an Owner. Its record is kept here for you." : app.status === "pending" ? "Your application has been sent and is waiting for review. We'll email you when there is a decision." : app.status === "approved" ? "Your application was approved. A List Contributor decides when to add your profile to the rankings." : "Your application was denied. Read the reviewer's message below."}</p>
        ${app.applicant_message ? `<div class="applicant-message"><h4>Message from the reviewer</h4><p>${esc(app.applicant_message)}</p></div>` : app.status !== "pending" ? '<p class="hint">No applicant-facing message was recorded for this decision.</p>' : ""}
        ${app.listed_editor_id ? `<a class="account-inline-link" href="/profile/?editor=${encodeURIComponent(app.listed_editor_id)}">View your editor profile</a>` : ""}</article>`;
      })
      .join("");
    root.innerHTML = `<h2 id="myApplicationsTitle">Your applications</h2><p class="hint">Your status stays available here even if an email is delayed.</p>${cards || '<p>You have no applications yet.</p><a class="account-inline-link" href="/apply/">Apply to be on the list</a>'}${total > 20 ? `<div class="application-pagination"><button data-page="previous" ${offset === 0 ? "disabled" : ""}>Previous applications</button><button data-page="next" ${offset + 20 >= total ? "disabled" : ""}>Next applications</button></div>` : ""}`;
  } catch (error) {
    root.innerHTML = `<h2 id="myApplicationsTitle">Your applications</h2><p class="account-feature-error" role="status">${esc(error.message)}</p><button id="retryMyApplications" type="button">Reload applications</button>`;
  } finally {
    busy = false;
    root.removeAttribute("aria-busy");
  }
}
root.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.page === "previous") offset = Math.max(0, offset - 20);
  if (button.dataset.page === "next" && offset + 20 < total) offset += 20;
  void load();
});
await load();
watchChanges(load, 30000);
