export function animateDisclosures(root = document) {
  root.querySelectorAll("details.profile-card").forEach(details => {
    if (details.dataset.animated) return;
    details.dataset.animated = "true";
    const summary = details.querySelector("summary"), content = details.querySelector(".profile-body");
    let animation;
    summary.addEventListener("click", event => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || !details.animate) {
        animation?.cancel();delete details.dataset.closing;details.style.overflow="";content.inert=false;return;
      }
      event.preventDefault();
      const closing = details.open && details.dataset.closing !== "true";
      const start = details.getBoundingClientRect().height;
      animation?.cancel();
      details.open = true;
      content.inert = closing;
      details.dataset.closing = String(closing);
      const border = parseFloat(getComputedStyle(details).borderTopWidth) + parseFloat(getComputedStyle(details).borderBottomWidth);
      const target = (closing ? summary.getBoundingClientRect().height : summary.getBoundingClientRect().height + content.getBoundingClientRect().height) + border;
      animation = details.animate([{height:start+"px"},{height:target+"px"}],{duration:220,easing:"ease-out"});
      details.style.overflow = "hidden";
      animation.onfinish = () => { details.open = !closing; delete details.dataset.closing; details.style.overflow = ""; animation = null; };
    });
  });
}
