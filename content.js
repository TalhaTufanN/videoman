(async () => {
  const host = location.hostname;
  if (host.includes("instagram.com")) {
    try {
      await import("./src/instagram/bootstrap.js");
    } catch (err) {
      console.error("Failed to load Instagram module:", err);
    }
  } else if (host.includes("twitter.com") || host.includes("x.com")) {
    try {
      await import("./src/x/bootstrap.js");
    } catch (err) {
      console.error("Failed to load Twitter/X module:", err);
    }
  }
})();
