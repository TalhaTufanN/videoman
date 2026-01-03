import { hideNativeOverlays } from "./dom.js";
import { addTopButtons, addBottomControls } from "./postControls.js";
import { state } from "./state.js";

export function checkForVideos() {
  const videos = document.querySelectorAll("video");
  const path = window.location.pathname;
  const isReelsPage = path === "/reels/" || path.startsWith("/reels/");
  const isPostPage = path.match(/^\/(p|reel|reels)\//);
  const isDirectPage = path.startsWith("/direct/");
  const isStoriesPage = path.startsWith("/stories/");

  videos.forEach((video) => {
    const container = video.parentElement;
    // If we've already processed this video, skip
    if (
      video.dataset &&
      (video.dataset.instaProcessed === "1" ||
        (container &&
          container.dataset &&
          container.dataset.instaType === "story"))
    )
      return;

    // On /stories/ page, let story handler take care of it (skip post/reel controls)
    if (isStoriesPage) {
      try {
        video.dataset.instaProcessed = "1";
        if (container) container.dataset.instaType = "story";
      } catch (e) {}
      return;
    }

    // On /reels/ page or post pages or direct messages, don't treat videos as stories - treat them as posts/reels
    let isStoryLike = false;
    if (!isReelsPage && !isPostPage && !isDirectPage) {
      // Check if this video is part of a post/reel by looking for shortcode links nearby
      const hasPostLink =
        container &&
        (container.querySelector(
          'a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]'
        ) ||
          container.closest(
            'a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]'
          ));

      // If we find a post/reel link nearby, treat it as a post, not a story
      if (hasPostLink) {
        isStoryLike = false;
      } else {
        // Detect story-like modal here to avoid adding post/reel controls on story videos
        // Use stricter checks: require fixed/dialog-like ancestor or very large coverage
        try {
          const rect = video.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            let anc = video.parentElement;
            while (anc && anc !== document.body) {
              const cs = getComputedStyle(anc);
              const aRect = anc.getBoundingClientRect();
              const isFixed =
                cs.position === "fixed" || cs.position === "sticky";
              const hasDialogRole =
                anc.getAttribute &&
                ((anc.getAttribute("role") || "").toLowerCase() === "dialog" ||
                  anc.getAttribute("aria-modal") === "true");
              const className = (anc.className || "").toString().toLowerCase();
              const hasStoryClass =
                className.includes("story") ||
                className.includes("stories") ||
                className.includes("viewer") ||
                className.includes("modal");

              // require either dialog/modal role or fixed positioning with large coverage
              if (
                hasDialogRole ||
                (isFixed &&
                  (aRect.width > window.innerWidth * 0.6 ||
                    aRect.height > window.innerHeight * 0.6)) ||
                hasStoryClass
              ) {
                isStoryLike = true;
                break;
              }
              anc = anc.parentElement;
            }

            // fallback: only treat as story if video itself covers most of viewport
            if (
              !isStoryLike &&
              (rect.width > window.innerWidth * 0.75 ||
                rect.height > window.innerHeight * 0.75)
            )
              isStoryLike = true;
          }
        } catch (e) {
          /* ignore */
        }
      }
    }
    // If it's a story-like video (and not on /reels/ page, post page, or direct messages), don't inject the post/reel panels here — story toolbar handles it.
    if (isStoryLike) {
      // mark as processed as story so other code won't add duplicate controls
      try {
        video.dataset.instaProcessed = "1";
        if (container) container.dataset.instaType = "story";
      } catch (e) {}
      return;
    }

    if (getComputedStyle(container).position === "static")
      container.style.position = "relative";

    container.classList.add("insta-hover-box");
    hideNativeOverlays(container);

    if (container.querySelector(".insta-master-controls")) return;

    if (state.USER_WANTS_AUDIO) {
      video.muted = false;
      video.volume = state.USER_VOLUME_LEVEL;
    }

    video.addEventListener("volumechange", (e) => {
      if (state.IS_DRAGGING_VOLUME) return;
      if (state.USER_WANTS_AUDIO && (video.muted || video.volume === 0)) {
        video.muted = false;
        video.volume = state.USER_VOLUME_LEVEL;
      }
    });

    addTopButtons(container, video);
    addBottomControls(container, video);
    // mark processed so story observer / other injectors skip
    try {
      video.dataset.instaProcessed = "1";
      if (container) container.dataset.instaType = "post";
    } catch (e) {}
  });
}

// --- VIDEO DETECTION & BUTTON INJECTION ---
export function startVideoObserver() {
  const videoObserver = new MutationObserver(() => {
    checkForVideos();
  });

  videoObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
