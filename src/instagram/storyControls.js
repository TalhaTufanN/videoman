import { getStoryVideoUrl, getVideoUrl } from "./api.js";
import { findShortcode } from "./dom.js";
import { SVG_DOWNLOAD, SVG_PLAY, SVG_PAUSE, SVG_LOADING } from "../icons.js";

// --- STORY VIDEO HANDLER ---
// Detect story-like videos (fixed-position modal) and add a floating toolbar
(() => {
  const TOOLBAR_Z = 2147483647;
  let active = null; // { video, toolbar, repositionHandler, removalObserver }

  function isLikelyStoryVideo(video) {
    try {
      const path = window.location.pathname || "";

      // Explicitly treat videos on /stories/ pages as stories
      if (path.startsWith("/stories/")) {
        return true;
      }

      // Don't treat videos on /reels/, /p/, /reel/, /direct/ pages as stories
      if (
        path === "/reels/" ||
        path.startsWith("/reels/") ||
        path.match(/^\/(p|reel|reels)\//) ||
        path.startsWith("/direct/")
      ) {
        return false;
      }

      const rect = video.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      // Require stronger signals to call it a story: dialog/aria-modal, story-related class, or fixed ancestor with large coverage
      let anc = video.parentElement;
      let found = false;
      while (anc && anc !== document.body) {
        const cs = getComputedStyle(anc);
        const aRect = anc.getBoundingClientRect();
        const isFixed = cs.position === "fixed" || cs.position === "sticky";
        const role =
          (anc.getAttribute &&
            (anc.getAttribute("role") || "").toLowerCase()) ||
          "";
        const ariaModal = anc.getAttribute && anc.getAttribute("aria-modal");
        const className = (anc.className || "").toString().toLowerCase();
        const hasStoryClass =
          className.includes("story") ||
          className.includes("stories") ||
          className.includes("viewer") ||
          className.includes("modal");

        if (
          role === "dialog" ||
          ariaModal === "true" ||
          hasStoryClass ||
          (isFixed &&
            (aRect.width > window.innerWidth * 0.6 ||
              aRect.height > window.innerHeight * 0.6))
        ) {
          found = true;
          break;
        }
        anc = anc.parentElement;
      }

      // fallback: treat as story only if it covers a very large portion of viewport
      if (
        !found &&
        (rect.width > window.innerWidth * 0.9 ||
          rect.height > window.innerHeight * 0.9)
      )
        found = true;

      // If URL indicates a reel/post, prefer NOT to treat as story unless explicit dialog/modal markers exist
      if (found) {
        if (/\/(reel|reels|p)\//i.test(path)) {
          // check explicitly for dialog/aria-modal in ancestors; if not present, don't mark
          let explicit = false;
          let a2 = video.parentElement;
          while (a2 && a2 !== document.body) {
            const role2 =
              (a2.getAttribute &&
                (a2.getAttribute("role") || "").toLowerCase()) ||
              "";
            const aria2 = a2.getAttribute && a2.getAttribute("aria-modal");
            if (role2 === "dialog" || aria2 === "true") {
              explicit = true;
              break;
            }
            a2 = a2.parentElement;
          }
          if (!explicit) return false;
        }
      }

      return !!found;
    } catch (e) {
      console.warn("isLikelyStoryVideo error", e);
      return false;
    }
  }

  function createToolbarElements() {
    const toolbar = document.createElement("div");
    toolbar.className = "insta-story-toolbar";
    Object.assign(toolbar.style, {
      position: "fixed",
      zIndex: String(TOOLBAR_Z),
      pointerEvents: "auto",
      display: "flex",
      gap: "8px",
      padding: "6px",
      borderRadius: "8px",
      background: "rgba(0,0,0,0.45)",
      alignItems: "center",
      boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
    });

    const btn = (html, title) => {
      const d = document.createElement("button");
      d.className = "insta-story-btn";
      d.innerHTML = html;
      d.title = title || "";
      Object.assign(d.style, {
        background: "transparent",
        border: "none",
        color: "#fff",
        width: "34px",
        height: "34px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      });
      return d;
    };

    const downloadBtn = btn(SVG_DOWNLOAD, "Download story");
    const playBtn = btn(SVG_PLAY, "Play/Pause");

    toolbar.appendChild(playBtn);
    toolbar.appendChild(downloadBtn);

    return { toolbar, downloadBtn, playBtn };
  }

  function positionToolbarForVideo(toolbar, video) {
    try {
      // Ensure toolbar has proper dimensions first
      if (toolbar.offsetWidth === 0 || toolbar.offsetHeight === 0) {
        // Force layout calculation
        toolbar.style.display = "flex";
        void toolbar.offsetWidth; // Force reflow
      }

      // For stories, place toolbar at top-right corner of viewport (safer and always visible)
      const path = window.location.pathname || "";
      if (path.startsWith("/stories/")) {
        // Fixed position at top-right corner, but offset left to avoid Instagram's X button
        // Instagram's X button is usually around 16px from right, so we'll place toolbar more to the left
        toolbar.style.right = "580px"; // More left to avoid X button
        toolbar.style.top = "16px";
        toolbar.style.left = "auto";
        toolbar.style.bottom = "auto";
      } else {
        // For other story-like videos, position relative to video
        const rect = video.getBoundingClientRect();
        const margin = 12;
        let left = rect.right - toolbar.offsetWidth - margin;
        let top = rect.top + margin;

        // Clamp to viewport
        left = Math.max(
          8,
          Math.min(left, window.innerWidth - toolbar.offsetWidth - 8)
        );
        top = Math.max(
          8,
          Math.min(top, window.innerHeight - toolbar.offsetHeight - 8)
        );

        toolbar.style.left = left + "px";
        toolbar.style.top = top + "px";
        toolbar.style.right = "auto";
        toolbar.style.bottom = "auto";
      }

      toolbar.style.display = "flex";
      toolbar.style.visibility = "visible";
      toolbar.style.opacity = "1";

      console.log(
        "Toolbar positioned. Video rect:",
        video.getBoundingClientRect()
      );
    } catch (e) {
      console.error("Error positioning toolbar", e);
    }
  }

  function attachToVideo(video) {
    if (active && active.video === video) return;
    detachActive();

    const { toolbar, downloadBtn, playBtn } = createToolbarElements();

    // Always append to body for maximum visibility and to avoid z-index/container issues
    document.body.appendChild(toolbar);
    console.log("Story toolbar created and attached to body");

    const reposition = () => {
      if (
        document.body.contains(video) &&
        (toolbar.parentElement || document.body.contains(toolbar))
      ) {
        positionToolbarForVideo(toolbar, video);
      }
    };

    // call once after appended (offsetWidth available)
    requestAnimationFrame(reposition);
    // Also call after a short delay to ensure video is positioned
    setTimeout(reposition, 100);
    setTimeout(reposition, 300);

    // Update play/pause button icon based on video state
    const updatePlayButtonIcon = () => {
      try {
        const isPaused = video.paused;
        playBtn.innerHTML = isPaused ? SVG_PLAY : SVG_PAUSE;
        const svg = playBtn.querySelector("svg");
        if (svg) {
          svg.style.width = "18px";
          svg.style.height = "18px";
        }
        console.log("Play button icon updated, video paused:", isPaused);
      } catch (err) {
        console.error("Error updating play button icon", err);
      }
    };

    // Set initial icon
    updatePlayButtonIcon();

    // Update icon when video play/pause state changes
    const playHandler = () => {
      console.log("Video play event");
      updatePlayButtonIcon();
    };
    const pauseHandler = () => {
      console.log("Video pause event");
      updatePlayButtonIcon();
    };

    video.addEventListener("play", playHandler);
    video.addEventListener("pause", pauseHandler);
    video.addEventListener("playing", playHandler);
    video.addEventListener("waiting", pauseHandler);

    // play/pause button click handler
    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      try {
        console.log("Play button clicked, current paused state:", video.paused);
        if (video.paused) {
          console.log("Attempting to play video");
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                console.log("Video play() successful");
                updatePlayButtonIcon();
              })
              .catch((err) => {
                console.error("Video play() failed", err);
                // Try clicking the video element itself
                video.click();
                updatePlayButtonIcon();
              });
          }
        } else {
          console.log("Attempting to pause video");
          video.pause();
          updatePlayButtonIcon();
        }
      } catch (err) {
        console.error("Error in play/pause handler", err);
        // Fallback: manually toggle
        if (video.paused) {
          video.play().catch(() => {
            video.click();
          });
        } else {
          video.pause();
        }
        setTimeout(updatePlayButtonIcon, 100);
      }
    });

    // download handler for stories
    downloadBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const path = window.location.pathname || "";
      const isStoriesPage = path.startsWith("/stories/");

      // Show loading state
      const originalHTML = downloadBtn.innerHTML;
      downloadBtn.innerHTML = SVG_LOADING;
      const loadSvg = downloadBtn.querySelector("svg");
      if (loadSvg) {
        loadSvg.style.width = "18px";
        loadSvg.style.height = "18px";
      }

      try {
        // For stories, use API method
        if (isStoriesPage) {
          console.log("Attempting to download story video via API...");
          const videoUrl = await getStoryVideoUrl();
          if (videoUrl) {
            console.log("Story video URL from API:", videoUrl);
            chrome.runtime.sendMessage({
              action: "download_final",
              url: videoUrl,
            });
            downloadBtn.innerHTML = originalHTML;
            return;
          }
          console.log("API method failed, trying direct video URL...");
        }

        // Try multiple methods to get video URL directly from video element
        let videoUrl = null;

        // Method 1: Try currentSrc (most reliable for playing videos)
        if (
          video.currentSrc &&
          !video.currentSrc.startsWith("blob:") &&
          !video.currentSrc.startsWith("data:")
        ) {
          videoUrl = video.currentSrc;
        }

        // Method 2: Try src attribute
        if (
          !videoUrl &&
          video.src &&
          !video.src.startsWith("blob:") &&
          !video.src.startsWith("data:")
        ) {
          videoUrl = video.src;
        }

        // Method 3: Try source elements
        if (!videoUrl) {
          const sourceElements = Array.from(
            (video.querySelectorAll && video.querySelectorAll("source")) || []
          );
          for (const source of sourceElements) {
            if (
              source.src &&
              !source.src.startsWith("blob:") &&
              !source.src.startsWith("data:")
            ) {
              videoUrl = source.src;
              break;
            }
          }
        }

        // Use direct video URL if found
        if (videoUrl) {
          console.log("Direct video URL found:", videoUrl);
          chrome.runtime.sendMessage({
            action: "download_final",
            url: videoUrl,
          });
          downloadBtn.innerHTML = originalHTML;
          return;
        }

        // Try shortcode-based API extraction as fallback (for non-stories)
        if (!isStoriesPage) {
          const container = video.parentElement || document.body;
          const shortcode = findShortcode(container) || findShortcode(video);
          if (shortcode) {
            const url = await getVideoUrl(shortcode);
            if (url) {
              chrome.runtime.sendMessage({ action: "download_final", url });
              downloadBtn.innerHTML = originalHTML;
              return;
            }
          }
        }

        throw new Error("Bu hikaye videosu için indirme adresi bulunamadı.");
      } catch (err) {
        console.error("Story download error", err);
        downloadBtn.innerHTML = originalHTML;
        alert("Hikaye indirilemedi: " + (err.message || "Unknown error"));
      }
    });

    // reposition on scroll/resize
    const onWindowChange = () => reposition();
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);

    // Also reposition periodically to keep toolbar in sync with video position
    const repositionInterval = setInterval(() => {
      if (document.body.contains(video) && document.body.contains(toolbar)) {
        reposition();
      } else {
        clearInterval(repositionInterval);
      }
    }, 500);

    // watch for video removal
    const removalObserver = new MutationObserver(() => {
      if (!document.body.contains(video)) detachActive();
    });
    removalObserver.observe(document.body, { childList: true, subtree: true });

    // mark as story-processed so main injector doesn't add its own controls
    try {
      video.dataset.instaProcessed = "1";
      if (video.parentElement) video.parentElement.dataset.instaType = "story";
    } catch (e) {}

    // Store video event listeners so we can clean them up later
    const videoEventListeners = {
      play: playHandler,
      pause: pauseHandler,
      playing: playHandler,
      waiting: pauseHandler,
    };
    active = {
      video,
      toolbar,
      repositionHandler: onWindowChange,
      removalObserver,
      repositionInterval,
      videoEventListeners,
    };
  }

  function detachActive() {
    if (!active) return;
    try {
      window.removeEventListener("resize", active.repositionHandler);
      window.removeEventListener("scroll", active.repositionHandler, true);
      if (active.repositionInterval) {
        clearInterval(active.repositionInterval);
      }
      // Remove video event listeners
      if (active.video && active.videoEventListeners) {
        active.video.removeEventListener(
          "play",
          active.videoEventListeners.play
        );
        active.video.removeEventListener(
          "pause",
          active.videoEventListeners.pause
        );
        active.video.removeEventListener(
          "playing",
          active.videoEventListeners.playing
        );
        active.video.removeEventListener(
          "waiting",
          active.videoEventListeners.waiting
        );
      }
      active.removalObserver.disconnect();
      if (active.toolbar && active.toolbar.parentElement)
        active.toolbar.parentElement.removeChild(active.toolbar);
      try {
        if (active.video) {
          delete active.video.dataset.instaProcessed;
          if (active.video.parentElement)
            delete active.video.parentElement.dataset.instaType;
        }
      } catch (e) {}
    } catch (e) {
      /* ignore */
    }
    active = null;
  }

  // Observe added/changed video elements and attach toolbar when a story-like video appears
  const storyObserver = new MutationObserver(() => {
    const path = window.location.pathname || "";
    const isStoriesPage = path.startsWith("/stories/");

    // Find all potential story videos
    const videos = Array.from(document.querySelectorAll("video"));
    let storyVideo = null;

    for (const v of videos) {
      // Skip if already processed by main injector as post/reel
      if (v.dataset && v.dataset.instaProcessed === "1") {
        // Check if it's marked as story or if we should override
        const container = v.parentElement;
        if (
          container &&
          container.dataset &&
          container.dataset.instaType === "story"
        ) {
          if (isLikelyStoryVideo(v)) {
            storyVideo = v;
            break;
          }
        }
        continue;
      }

      if (isLikelyStoryVideo(v)) {
        storyVideo = v;
        break;
      }
    }

    // If we found a story video, attach toolbar to it
    if (storyVideo) {
      // Only attach if it's not already the active video
      if (!active || active.video !== storyVideo) {
        try {
          storyVideo.dataset.instaProcessed = "1";
          if (storyVideo.parentElement)
            storyVideo.parentElement.dataset.instaType = "story";
        } catch (e) {}
        attachToVideo(storyVideo);
      }
    } else if (!isStoriesPage) {
      // Only cleanup if we're not on stories page (videos might be loading)
      detachActive();
    }
  });
  storyObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
  });

  // initial scan for stories on page load
  function initialStoryScan() {
    const videos = Array.from(document.querySelectorAll("video"));
    for (const v of videos) {
      // Skip if already processed by main injector as post/reel
      if (v.dataset && v.dataset.instaProcessed === "1") {
        const container = v.parentElement;
        if (
          container &&
          container.dataset &&
          container.dataset.instaType === "story"
        ) {
          if (isLikelyStoryVideo(v)) {
            try {
              v.dataset.instaProcessed = "1";
              if (v.parentElement) v.parentElement.dataset.instaType = "story";
            } catch (e) {}
            attachToVideo(v);
            return;
          }
        }
        continue;
      }

      if (isLikelyStoryVideo(v)) {
        try {
          v.dataset.instaProcessed = "1";
          if (v.parentElement) v.parentElement.dataset.instaType = "story";
        } catch (e) {}
        attachToVideo(v);
        return;
      }
    }
  }

  // Run initial scan multiple times with delays to catch videos that load asynchronously
  function runScans() {
    initialStoryScan();
    setTimeout(initialStoryScan, 500);
    setTimeout(initialStoryScan, 1000);
    setTimeout(initialStoryScan, 2000);
  }

  // Run initial scan when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runScans);
  } else {
    runScans();
  }

  // Also run scans periodically on stories pages to catch video changes
  const path = window.location.pathname || "";
  if (path.startsWith("/stories/")) {
    setInterval(() => {
      if (!active) {
        initialStoryScan();
      }
    }, 1500);
  }
})();
