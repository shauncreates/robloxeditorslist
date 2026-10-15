const actionIcons = {
  addEditor: "add",
  addStyle: "add",
  addMain: "add",
  convertApplication: "add",

  fetchAll: "download",
  fetchLegacy: "download",
  fetchPic: "download",

  delEditor: "delete",
  delStyle: "delete",
  rmMain: "delete",

  up: "up",
  down: "down",
  top: "top",

  approveClaim: "review",
  rejectClaim: "close",

  refreshApplications: "reset",
  refreshLinks: "reset",
  refreshUsers: "reset",

  previousApplications: "back",
  previousLinks: "back",
  previousUsers: "back",

  nextApplications: "arrow",
  nextLinks: "arrow",
  nextUsers: "arrow",
};

const buttonIcons = {
  submit: "account",
  switch: "account",
  haveCode: "key",
  resend: "mail",
  changeEmail: "mail",

  submitButton: "applications",
  fetchPic: "download",
  saveNow: "save",

  retryProfile: "reset",
  retry: "reset",

  reloadContributors: "reset",
  manageContributorLinks: "link",
  addContributor: "users",
  saveContributors: "save",
};

function enhanceAction(element) {
  if (element.hasAttribute("data-no-icon")) return;

  if (!element.dataset.icon && element.querySelector(":scope > svg.rel-icon")) {
    return;
  }

  const icon =
    element.dataset.icon ||
    actionIcons[element.dataset.act] ||
    buttonIcons[element.id] ||
    (element.dataset.act === "applicationStatus"
      ? element.dataset.status === "approved"
        ? "review"
        : "close"
      : null) ||
    (element.hasAttribute("data-move")
      ? element.dataset.move === "-1"
        ? "up"
        : "down"
      : null);

  if (!/^[a-z-]+$/.test(icon || "")) return;

  const current = element.querySelector(":scope > .rel-action-label");

  if (current && element.querySelector(":scope > svg.rel-icon")) {
    return;
  }

  const label = document.createElement("span");
  label.className = "rel-action-label";
  label.append(...element.childNodes);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  svg.classList.add("rel-icon");
  svg.setAttribute("aria-hidden", "true");

  const use = document.createElementNS(svg.namespaceURI, "use");

  use.setAttribute("href", "/media/action-icons.svg#" + icon);

  svg.append(use);

  element.append(svg, label);

  element.classList.add("rel-action", "rel-action--enhanced");

  if (
    element.closest("nav,.admin-actions,.tabs") &&
    !element.closest(".account-secondary-links")
  ) {
    element.classList.add("rel-action--reveal");
  }

  if (
    element.classList.contains("pri") ||
    element.classList.contains("primary-link")
  ) {
    element.classList.add("rel-action--account");
  }
}

const selector = "button,a[data-icon]";

function measureNavigationLabel(element) {
  if (!element.closest("nav,.admin-actions,.tabs")) return;
  const label = element.querySelector(":scope > span:not(.rel-sr)");
  if (!label) return;
  const range = document.createRange();
  range.selectNodeContents(label);
  const width = Math.ceil(range.getBoundingClientRect().width);
  if (width) element.style.setProperty("--rel-label-width", width + "px");
}

function measureNavigation(root) {
  if (root.matches(".rel-action--reveal")) measureNavigationLabel(root);
  root.querySelectorAll(".rel-action--reveal").forEach(measureNavigationLabel);
}

function enhanceWithin(root) {
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  if (root.matches(selector)) {
    enhanceAction(root);
  }

  root.querySelectorAll(selector).forEach(enhanceAction);
  measureNavigation(root);
}

enhanceWithin(document.body);

new MutationObserver((records) => {
  const changed = new Set();

  for (const record of records) {
    const owner =
      record.target.nodeType === Node.ELEMENT_NODE
        ? record.target.closest(selector)
        : record.target.parentElement?.closest(selector);

    if (owner) changed.add(owner);

    for (const node of record.addedNodes) {
      enhanceWithin(node);
    }
  }

  changed.forEach((element) => {
    enhanceAction(element);
    measureNavigationLabel(element);
  });
}).observe(document.body, {
  childList: true,
  subtree: true,
});

let navigationFrame;
function refreshNavigation() {
  cancelAnimationFrame(navigationFrame);
  navigationFrame = requestAnimationFrame(() => measureNavigation(document.body));
}
window.addEventListener("resize", refreshNavigation, { passive: true });
document.fonts.ready.then(refreshNavigation);
document.fonts.addEventListener("loadingdone", refreshNavigation);
