import { formatTime } from "../utils/time.js";
import { getVideoUrl } from "./api.js";
import {
  SVG_PLAY,
  SVG_PAUSE,
  SVG_VOLUME_UP,
  SVG_VOLUME_MUTE,
  SVG_FULLSCREEN_ENTER,
  SVG_FULLSCREEN_EXIT,
  SVG_DOWNLOAD,
  SVG_LOADING,
} from "../icons.js";
import { createButton } from "../utils.js";
import { findShortcode } from "./dom.js";
import { state } from "./state.js";

export function addTopButtons(container, video) {
  // Do not add post/reel top buttons if this container is marked as a story
  try {
    if (
      container &&
      container.dataset &&
      container.dataset.instaType === "story"
    )
      return;
  } catch (e) {}
  const panel = document.createElement("div");
  panel.className = "insta-master-controls";

  const btnSpeed = createButton("1x", () => {
    if (video.playbackRate === 1) video.playbackRate = 1.5;
    else if (video.playbackRate === 1.5) video.playbackRate = 2;
    else video.playbackRate = 1;
    btnSpeed.innerText = video.playbackRate + "x";
  });

  const btnDownload = document.createElement("div");
  btnDownload.className = "insta-master-btn";
  btnDownload.style.padding = "0";
  btnDownload.style.width = "30px";
  btnDownload.style.justifyContent = "center";
  btnDownload.innerHTML = SVG_DOWNLOAD;
  const dlSvg = btnDownload.querySelector("svg");
  if (dlSvg) {
    dlSvg.style.width = "18px";
    dlSvg.style.height = "18px";
  }

  // --- DOWNLOAD HANDLER ---
  btnDownload.onclick = async (e) => {
    e.stopPropagation();
    e.preventDefault();

    btnDownload.innerHTML = SVG_LOADING;
    const loadSvg = btnDownload.querySelector("svg");
    if (loadSvg) {
      loadSvg.style.width = "18px";
      loadSvg.style.height = "18px";
    }

    try {
      let shortcode = findShortcode(container);
      const path = window.location.pathname || "";
      // On /reels/, /direct/, or post pages, try finding shortcode from video element itself if container search failed
      if (
        !shortcode &&
        (path === "/reels/" ||
          path.startsWith("/reels/") ||
          path.startsWith("/direct/") ||
          path.match(/^\/(p|reel|reels)\//))
      ) {
        shortcode = findShortcode(video);
      }
      if (!shortcode) {
        throw new Error("Could not find post ID");
      }

      console.log("Found shortcode:", shortcode);
      const videoUrl = await getVideoUrl(shortcode);

      if (!videoUrl) {
        throw new Error("Could not extract video URL from Instagram API");
      }

      console.log("Got video URL from API:", videoUrl);
      chrome.runtime.sendMessage({ action: "download_final", url: videoUrl });
      showSuccess(btnDownload);
    } catch (err) {
      console.error("Download error:", err);
      showError(btnDownload, err.message || "Download failed");
    }
  };

  const btnFullscreen = document.createElement("div");
  btnFullscreen.className = "insta-master-btn";
  btnFullscreen.style.padding = "0";
  btnFullscreen.style.width = "30px";
  btnFullscreen.style.justifyContent = "center";

  const updateIcon = () => {
    let iconHTML = document.fullscreenElement
      ? SVG_FULLSCREEN_EXIT
      : SVG_FULLSCREEN_ENTER;
    btnFullscreen.innerHTML = iconHTML;
    const svg = btnFullscreen.querySelector("svg");
    if (svg) {
      svg.style.width = "18px";
      svg.style.height = "18px";
    }
  };
  updateIcon();

  btnFullscreen.onclick = (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      if (container.requestFullscreen) {
        container.requestFullscreen();
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.justifyContent = "center";
        container.style.background = "#000";
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      }
    }
  };

  document.addEventListener("fullscreenchange", () => {
    updateIcon();
    if (!document.fullscreenElement) {
      container.style.display = "";
      container.style.alignItems = "";
      container.style.justifyContent = "";
      container.style.background = "";
    }
  });

  panel.appendChild(btnSpeed);
  panel.appendChild(btnDownload);
  panel.appendChild(btnFullscreen);
  container.appendChild(panel);
  try {
    container.dataset.instaType = "post";
  } catch (e) {}
}
export function addBottomControls(container, video) {
  // Do not add post/reel bottom controls if this container is marked as a story
  try {
    if (
      container &&
      container.dataset &&
      container.dataset.instaType === "story"
    )
      return;
  } catch (e) {}
  const bottomPanel = document.createElement("div");
  bottomPanel.className = "insta-bottom-panel";

  const playBtn = document.createElement("div");
  playBtn.className = "insta-icon-svg";
  playBtn.innerHTML = video.paused ? SVG_PLAY : SVG_PAUSE;

  playBtn.onclick = (e) => {
    e.stopPropagation();
    if (video.paused) {
      video.play();
      video.muted = false;
      video.volume = state.USER_VOLUME_LEVEL;
    } else {
      video.pause();
    }
  };

  video.addEventListener("play", () => {
    playBtn.innerHTML = SVG_PAUSE;
  });
  video.addEventListener("pause", () => {
    playBtn.innerHTML = SVG_PLAY;
  });

  // Prevent pause when tab is hidden - keep playing in background
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Tab is hidden - do nothing, let video keep playing
      console.log("Tab hidden, video continues playing");
    } else {
      // Tab is visible again - do nothing, video state unchanged
      console.log("Tab visible again");
    }
  });

  const seekSlider = document.createElement("input");
  seekSlider.type = "range";
  seekSlider.id = "seek-slider";
  seekSlider.min = 0;
  seekSlider.max = 100;
  seekSlider.value = 0;

  const timeDisplay = document.createElement("span");
  timeDisplay.className = "insta-time-text";
  timeDisplay.innerText = "00:00 / 00:00";

  const volIcon = document.createElement("div");
  volIcon.className = "insta-icon-svg";
  volIcon.style.width = "20px";
  volIcon.innerHTML = SVG_VOLUME_UP;

  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.id = "volume-slider";
  volumeSlider.min = 0;
  volumeSlider.max = 1;
  volumeSlider.step = 0.05;
  volumeSlider.value = state.USER_VOLUME_LEVEL;

  const updateUI = () => {
    volIcon.innerHTML = state.USER_WANTS_AUDIO
      ? SVG_VOLUME_UP
      : SVG_VOLUME_MUTE;
    volumeSlider.value = state.USER_WANTS_AUDIO ? state.USER_VOLUME_LEVEL : 0;
  };
  updateUI();

  volumeSlider.addEventListener("mousedown", () => {
    state.IS_DRAGGING_VOLUME = true;
  });
  volumeSlider.addEventListener("mouseup", () => {
    state.IS_DRAGGING_VOLUME = false;
  });
  volumeSlider.addEventListener("touchstart", () => {
    state.IS_DRAGGING_VOLUME = true;
  });
  volumeSlider.addEventListener("touchend", () => {
    state.IS_DRAGGING_VOLUME = false;
  });

  volumeSlider.addEventListener("input", (e) => {
    e.stopPropagation();
    const val = parseFloat(e.target.value);

    if (val > 0) {
      state.USER_WANTS_AUDIO = true;
      state.USER_VOLUME_LEVEL = val;
      video.muted = false;
      video.volume = val;
    } else {
      state.USER_WANTS_AUDIO = false;
      video.muted = true;
    }
    updateUI();
  });

  // Mouse wheel scroll support for volume adjustment
  volumeSlider.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();

      let newVal = parseFloat(volumeSlider.value);
      const step = 0.05;

      if (e.deltaY < 0) {
        // Scroll up - increase volume
        newVal = Math.min(1, newVal + step);
      } else if (e.deltaY > 0) {
        // Scroll down - decrease volume
        newVal = Math.max(0, newVal - step);
      }

      volumeSlider.value = newVal;

      if (newVal > 0) {
        state.USER_WANTS_AUDIO = true;
        state.USER_VOLUME_LEVEL = newVal;
        video.muted = false;
        video.volume = newVal;
      } else {
        state.USER_WANTS_AUDIO = false;
        video.muted = true;
      }
      updateUI();
    },
    { passive: false }
  );

  volIcon.onclick = (e) => {
    e.stopPropagation();
    state.USER_WANTS_AUDIO = !state.USER_WANTS_AUDIO;
    if (state.USER_WANTS_AUDIO) {
      video.muted = false;
      video.volume =
        state.USER_VOLUME_LEVEL > 0 ? state.USER_VOLUME_LEVEL : 0.5;
    } else {
      video.muted = true;
    }
    updateUI();
  };

  video.addEventListener("timeupdate", () => {
    if (!isNaN(video.duration)) {
      seekSlider.max = video.duration;
      seekSlider.value = video.currentTime;
      timeDisplay.innerText =
        formatTime(video.currentTime) + " / " + formatTime(video.duration);
    }
  });

  seekSlider.addEventListener("input", (e) => {
    e.stopPropagation();
    video.currentTime = e.target.value;
  });

  bottomPanel.appendChild(playBtn);
  bottomPanel.appendChild(seekSlider);
  bottomPanel.appendChild(timeDisplay);
  bottomPanel.appendChild(volIcon);
  bottomPanel.appendChild(volumeSlider);

  container.appendChild(bottomPanel);
  try {
    container.dataset.instaType = "post";
  } catch (e) {}
}
export function showSuccess(btn) {
  setTimeout(() => {
    btn.innerHTML = SVG_DOWNLOAD;
    btn.style.backgroundColor = "#28a745";
    const s = btn.querySelector("svg");
    if (s) {
      s.style.width = "18px";
      s.style.height = "18px";
    }
    setTimeout(() => {
      btn.style.backgroundColor = "";
    }, 1500);
  }, 500);
}

export function showError(btn, msg) {
  btn.innerHTML = SVG_DOWNLOAD;
  btn.style.backgroundColor = "#dc3545";
  alert(msg);
  const s = btn.querySelector("svg");
  if (s) {
    s.style.width = "18px";
    s.style.height = "18px";
  }
  setTimeout(() => {
    btn.style.backgroundColor = "";
  }, 1500);
}
