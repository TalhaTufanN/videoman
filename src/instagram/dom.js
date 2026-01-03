export function findShortcode(container) {
  const path = window.location.pathname;
  const urlMatch = path.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
  if (urlMatch && urlMatch[2]) return urlMatch[2];

  // First try to find link within the container itself (for /reels/ page)
  if (container) {
    const containerLink = container.querySelector(
      'a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]'
    );
    if (containerLink) {
      const href = containerLink.getAttribute("href");
      const match = href && href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
      if (match && match[2]) return match[2];
    }
  }

  let parent = container ? container.parentElement : null;
  for (let i = 0; i < 20; i++) {
    if (!parent || parent === document.body) break;
    const postLink = parent.querySelector(
      'a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]'
    );
    if (postLink) {
      const href = postLink.getAttribute("href");
      const match = href && href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
      if (match && match[2]) return match[2];
    }
    parent = parent.parentElement;
  }

  const nearbyLink = container
    ? container.closest('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]')
    : null;
  if (nearbyLink) {
    const href = nearbyLink.getAttribute("href");
    const match = href && href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    if (match && match[2]) return match[2];
  }
  return null;
}
export function hideNativeOverlays(container) {
  const potentialButtons = container.querySelectorAll(
    'button, div[role="button"]'
  );
  potentialButtons.forEach((btn) => {
    if (
      btn.closest(".insta-master-controls") ||
      btn.closest(".insta-bottom-panel")
    )
      return;
    const label = (btn.ariaLabel || "").toLowerCase();
    if (
      label.includes("ses") ||
      label.includes("audio") ||
      label.includes("mute") ||
      label.includes("voice")
    ) {
      btn.style.display = "none";
    }
  });
}
