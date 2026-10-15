export function animateDisclosures(root = document) {
  root.querySelectorAll("details.profile-card").forEach(details => {
    if (details.dataset.animated) return;
    details.dataset.animated = "true";
    const summary = details.querySelector("summary"), content = details.querySelector(".profile-body");
    let animation, contentAnimation;
    summary.addEventListener("click", event => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || !details.animate) {
        animation?.cancel();contentAnimation?.cancel();delete details.dataset.closing;details.style.overflow="";content.inert=false;return;
      }
      event.preventDefault();
      const closing = details.open && details.dataset.closing !== "true";
      const start = details.getBoundingClientRect().height;
      const contentStyle = getComputedStyle(content);
      const opacity = details.open ? contentStyle.opacity : 0;
      const transform = details.open ? contentStyle.transform : "translateY(-6px)";
      animation?.cancel();contentAnimation?.cancel();
      details.open = true;
      content.inert = closing;
      details.dataset.closing = String(closing);
      const border = parseFloat(getComputedStyle(details).borderTopWidth) + parseFloat(getComputedStyle(details).borderBottomWidth);
      const target = (closing ? summary.getBoundingClientRect().height : summary.getBoundingClientRect().height + content.getBoundingClientRect().height) + border;
      animation = details.animate([{height:start+"px"},{height:target+"px"}],{duration:260,easing:"cubic-bezier(.2,.8,.2,1)"});
      contentAnimation = content.animate([{opacity,transform},{opacity:closing?0:1,transform:closing?"translateY(-6px)":"translateY(0)"}],{duration:200,easing:"ease-out",fill:"both"});
      details.style.overflow = "hidden";
      animation.onfinish = () => { details.open = !closing; delete details.dataset.closing; details.style.overflow = ""; contentAnimation?.cancel();contentAnimation=null;animation = null; };
    });
  });
}
