document.addEventListener("click", event => {
  const button = event.target.closest("button[data-youtube]");
  if (!button || !/^[A-Za-z0-9_-]{11}$/.test(button.dataset.youtube)) return;
  const container = button.closest(".video-consent");
  if (!container) return;
  const frame = document.createElement("iframe");
  frame.src = "https://www.youtube-nocookie.com/embed/" + button.dataset.youtube;
  frame.title = button.dataset.videoTitle || "Editor showcase on YouTube";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  container.replaceChildren(frame);
  frame.focus();
});
