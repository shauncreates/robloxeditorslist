const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function mountActivity(root, accountFetch, api) {
  let offset = 0,
    total = 0,
    busy = false;
  root.innerHTML =
    '<h2>Activity log</h2><p class="hint">Private account, application and ranking history, with the account responsible for each action.</p><div class="inline"><button id="refreshActivity" data-icon="reset">Refresh log</button><button id="retryEmails" data-icon="mail">Retry queued emails</button></div><p id="activityNotice" class="hint" role="status"></p><div id="activityList"></div><div class="inline"><button id="activityPrevious">Previous page</button><button id="activityNext">Next page</button></div>';
  const $ = (selector) => root.querySelector(selector);
  async function load() {
    if (busy) return;
    busy = true;
    try {
      const response = await accountFetch(
          "/api/account/activity?offset=" + offset,
        ),
        data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not load the activity log.");
      total = data.total;
      const labels = {
        rank_change: "Ranking changes",
        save_rankings: "Editor or list save",
        submit_application: "Application submitted",
        review_application: "Application reviewed",
        archive_application: "Application archived",
        convert_application: "Application added to the list",
        auto_link_editor: "Editor profile linked automatically",
        link_youtube: "YouTube channel linked",
        unlink_youtube: "YouTube channel disconnected",
      };
      $("#activityList").innerHTML =
        data.events
          .map(
            (event) =>
              `<article class="card"><h3>${esc(labels[event.action] || event.action)}</h3><p class="hint">${esc(new Date(event.created_at).toLocaleString())} · ${esc(event.actor_username || event.actor_id || "Historical actor not recorded")}</p><p class="hint">Record: ${esc(event.target)}</p>${event.details?.reason ? `<p>Private staff note: ${esc(event.details.reason)}</p>` : ""}${Array.isArray(event.details?.changes) ? `<details><summary>View ${event.details.changes.length} placement changes</summary><ul>${event.details.changes.map((change) => `<li>${esc(change.editor_name || change.editor_id)} · ${esc(change.list_id)}: ${change.from_rank == null ? "not listed" : esc(change.from_rank)} to ${change.to_rank == null ? "removed" : esc(change.to_rank)}</li>`).join("")}</ul></details>` : ""}</article>`,
          )
          .join("") || "<p>No activity has been recorded in this view.</p>";
      $("#activityNotice").textContent =
        data.notifications.queued +
        " emails queued, " +
        data.notifications.failed +
        " waiting after a failed attempt, " +
        data.notifications.sent +
        " accepted by the email provider. " +
        total +
        " activity entries.";
    } catch (error) {
      $("#activityNotice").textContent =
        error.message + " Use Refresh log to retry.";
    } finally {
      busy = false;
      $("#activityPrevious").disabled = offset === 0;
      $("#activityNext").disabled = offset + 50 >= total;
    }
  }
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || busy) return;
    if (button.id === "activityPrevious") offset = Math.max(0, offset - 50);
    if (button.id === "activityNext" && offset + 50 < total) offset += 50;
    if (button.id === "retryEmails") {
      button.disabled = true;
      try {
        const { ok, j } = await api("/api/applications/notifications", {});
        if (!ok) throw new Error(j.error || "Could not retry emails.");
        await load();
        $("#activityNotice").textContent += " Retry result: " + j.status + ".";
      } catch (error) {
        $("#activityNotice").textContent = error.message;
      } finally {
        button.disabled = false;
      }
      return;
    }
    await load();
  });
  void load();
}
