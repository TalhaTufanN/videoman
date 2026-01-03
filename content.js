(async () => {
  const host = location.hostname;
  if (host.includes("instagram.com")) {
    try {
      await import("./src/instagram/bootstrap.js");
    } catch (err) {
      console.error("Failed to load Instagram module:", err);
    }
  }
})();
