import { IG_BASE_URL, IG_SHORTCODE_ALPHABET } from "./constants.js";
import { getFetchOptions } from "../utils/fetch.js";

export async function getUserId(username) {
  const apiURL = new URL("/api/v1/users/web_profile_info/", IG_BASE_URL);
  apiURL.searchParams.set("username", username);
  try {
    const response = await fetch(apiURL.href, getFetchOptions());
    const json = await response.json();
    return json.data.user["id"];
  } catch (error) {
    console.error("Error getting user ID:", error);
    return null;
  }
}

// Get story media for a user
export async function getStoryPhotos(userId) {
  const apiURL = new URL("/api/v1/feed/reels_media/", IG_BASE_URL);
  apiURL.searchParams.set("reel_ids", userId);
  try {
    const response = await fetch(apiURL.href, getFetchOptions());
    const json = await response.json();
    return json.reels[userId];
  } catch (error) {
    console.error("Error getting story photos:", error);
    return null;
  }
}

// Get story video URL for current story
export async function getStoryVideoUrl() {
  try {
    // Get username from URL: /stories/username/123
    const path = window.location.pathname || "";
    const match = path.match(/\/stories\/([^\/]+)/);
    if (!match || !match[1]) {
      console.log("Could not extract username from URL");
      return null;
    }
    const username = match[1];
    console.log("Found username:", username);

    // Get user ID
    const userId = await getUserId(username);
    if (!userId) {
      console.log("Could not get user ID");
      return null;
    }
    console.log("Found user ID:", userId);

    // Get story media
    const storyData = await getStoryPhotos(userId);
    if (!storyData || !storyData.items || storyData.items.length === 0) {
      console.log("Could not get story data");
      return null;
    }
    console.log("Found story items:", storyData.items.length);

    // Find video items and return the first video URL (or we could try to match current video)
    for (const item of storyData.items) {
      // media_type !== 1 means video
      if (
        item.media_type !== 1 &&
        item.video_versions &&
        item.video_versions[0]
      ) {
        const videoUrl = item.video_versions[0].url;
        console.log("Found story video URL:", videoUrl);
        return videoUrl;
      }
    }

    console.log("No video found in story items");
    return null;
  } catch (error) {
    console.error("Error getting story video URL:", error);
    return null;
  }
}

export function convertToPostId(shortcode) {
  let id = BigInt(0);
  for (let i = 0; i < shortcode.length; i++) {
    let char = shortcode[i];
    id = id * BigInt(64) + BigInt(IG_SHORTCODE_ALPHABET.indexOf(char));
  }
  return id.toString(10);
}
export async function getPostPhotos(shortcode) {
  const postId = convertToPostId(shortcode);
  const apiURL = new URL(`/api/v1/media/${postId}/info/`, IG_BASE_URL);
  try {
    let response = await fetch(apiURL.href, getFetchOptions());
    if (response.status === 400) {
      console.log("Post ID conversion failed");
      return null;
    }
    if (!response.ok) {
      console.error("API error:", response.status);
      return null;
    }
    const json = await response.json();
    return json.items[0];
  } catch (error) {
    console.error("Error fetching post data:", error);
    return null;
  }
}

export async function getVideoUrl(shortcode) {
  try {
    console.log("Fetching video URL for shortcode:", shortcode);
    const mediaData = await getPostPhotos(shortcode);
    if (!mediaData) {
      console.log("No media data returned");
      return null;
    }

    // Check carousel media first
    if (mediaData.carousel_media && mediaData.carousel_media.length > 0) {
      for (const item of mediaData.carousel_media) {
        if (
          item.media_type !== 1 &&
          item.video_versions &&
          item.video_versions[0]
        ) {
          console.log("Found video in carousel");
          return item.video_versions[0].url;
        }
      }
    }

    // Check main media
    if (
      mediaData.media_type !== 1 &&
      mediaData.video_versions &&
      mediaData.video_versions[0]
    ) {
      console.log("Found video in main media");
      return mediaData.video_versions[0].url;
    }

    console.log("No video found in media data");
    return null;
  } catch (error) {
    console.error("Error getting video URL:", error);
    return null;
  }
}
