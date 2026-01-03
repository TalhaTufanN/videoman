// --- HELPER FUNCTIONS ---
export function getCookieValue(name) {
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1];
}
export function getFetchOptions() {
  return {
    headers: {
      "x-csrftoken": getCookieValue("csrftoken") || "",
      "x-ig-app-id": "936619743392459",
      "x-ig-www-claim": sessionStorage.getItem("www-claim-v2") || "",
      "x-requested-with": "XMLHttpRequest",
    },
    referrer: window.location.href,
    referrerPolicy: "strict-origin-when-cross-origin",
    method: "GET",
    mode: "cors",
    credentials: "include",
  };
}
