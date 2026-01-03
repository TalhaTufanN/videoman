import "./storyControls.js";
import { startVideoObserver } from "./videoDetection.js";

function registerBackgroundListeners() {
  chrome.runtime?.onMessage?.addListener((msg) => {
    if (!msg?.action) return;

    if (msg.action === "download_failed") {
      alert("Download failed: " + (msg.message || "Unknown error"));
    }
  });
}
startVideoObserver();
registerBackgroundListeners();
