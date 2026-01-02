// ICONS moved to content/icons.js (loaded earlier via manifest to keep simple modularization without a build step)

// --- INSTAGRAM API CONSTANTS ---
const IG_BASE_URL = window.location.origin + '/';
const IG_SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// --- GLOBAL STATE ---
let USER_WANTS_AUDIO = true;
let USER_VOLUME_LEVEL = 0.5;
let IS_DRAGGING_VOLUME = false;

// --- HELPER FUNCTIONS ---
function getCookieValue(name) {
    return document.cookie.split('; ')
        .find(row => row.startsWith(`${name}=`))
        ?.split('=')[1];
}

function getFetchOptions() {
    return {
        headers: {
            'x-csrftoken': getCookieValue('csrftoken') || '',
            'x-ig-app-id': '936619743392459',
            'x-ig-www-claim': sessionStorage.getItem('www-claim-v2') || '',
            'x-requested-with': 'XMLHttpRequest'
        },
        referrer: window.location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        method: 'GET',
        mode: 'cors',
        credentials: 'include'
    };
}

// Helper function to get value by key from nested objects (from Instagram-Downloader-main)
function getValueByKey(obj, key) {
    if (typeof obj !== 'object' || obj === null) return null;
    const stack = [obj];
    const visited = new Set();
    while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        try {
            if (current[key] !== undefined) return current[key];
        } catch (error) {
            if (error.name === 'SecurityError') continue;
            console.log(error);
        }
        for (const value of Object.values(current)) {
            if (typeof value === 'object' && value !== null) {
                stack.push(value);
            }
        }
    }
    return null;
}

// Get user ID from username (from Instagram-Downloader-main)
async function getUserId(username) {
    const apiURL = new URL('/api/v1/users/web_profile_info/', IG_BASE_URL);
    apiURL.searchParams.set('username', username);
    try {
        const response = await fetch(apiURL.href, getFetchOptions());
        const json = await response.json();
        return json.data.user['id'];
    } catch (error) {
        console.error('Error getting user ID:', error);
        return null;
    }
}

// Get story media for a user (from Instagram-Downloader-main)
async function getStoryPhotos(userId) {
    const apiURL = new URL('/api/v1/feed/reels_media/', IG_BASE_URL);
    apiURL.searchParams.set('reel_ids', userId);
    try {
        const response = await fetch(apiURL.href, getFetchOptions());
        const json = await response.json();
        return json.reels[userId];
    } catch (error) {
        console.error('Error getting story photos:', error);
        return null;
    }
}

// Get story video URL for current story
async function getStoryVideoUrl() {
    try {
        // Get username from URL: /stories/username/123
        const path = window.location.pathname || '';
        const match = path.match(/\/stories\/([^\/]+)/);
        if (!match || !match[1]) {
            console.log('Could not extract username from URL');
            return null;
        }
        const username = match[1];
        console.log('Found username:', username);
        
        // Get user ID
        const userId = await getUserId(username);
        if (!userId) {
            console.log('Could not get user ID');
            return null;
        }
        console.log('Found user ID:', userId);
        
        // Get story media
        const storyData = await getStoryPhotos(userId);
        if (!storyData || !storyData.items || storyData.items.length === 0) {
            console.log('Could not get story data');
            return null;
        }
        console.log('Found story items:', storyData.items.length);
        
        // Find video items and return the first video URL (or we could try to match current video)
        for (const item of storyData.items) {
            // media_type !== 1 means video
            if (item.media_type !== 1 && item.video_versions && item.video_versions[0]) {
                const videoUrl = item.video_versions[0].url;
                console.log('Found story video URL:', videoUrl);
                return videoUrl;
            }
        }
        
        console.log('No video found in story items');
        return null;
    } catch (error) {
        console.error('Error getting story video URL:', error);
        return null;
    }
}

function convertToPostId(shortcode) {
    let id = BigInt(0);
    for (let i = 0; i < shortcode.length; i++) {
        let char = shortcode[i];
        id = (id * BigInt(64)) + BigInt(IG_SHORTCODE_ALPHABET.indexOf(char));
    }
    return id.toString(10);
}

function findShortcode(container) {
    const path = window.location.pathname;
    const urlMatch = path.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    if (urlMatch && urlMatch[2]) return urlMatch[2];

    // First try to find link within the container itself (for /reels/ page)
    if (container) {
        const containerLink = container.querySelector('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]');
        if (containerLink) {
            const href = containerLink.getAttribute('href');
            const match = href && href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
            if(match && match[2]) return match[2];
        }
    }

    let parent = container ? container.parentElement : null;
    for(let i=0; i<20; i++) {
        if(!parent || parent === document.body) break;
        const postLink = parent.querySelector('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]');
        if (postLink) {
            const href = postLink.getAttribute('href');
            const match = href && href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
            if(match && match[2]) return match[2];
        }
        parent = parent.parentElement;
    }
    
    const nearbyLink = container ? container.closest('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]') : null;
    if(nearbyLink) {
        const href = nearbyLink.getAttribute('href');
        const match = href && href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
        if(match && match[2]) return match[2];
    }
    return null;
}

async function getPostPhotos(shortcode) {
    const postId = convertToPostId(shortcode);
    const apiURL = new URL(`/api/v1/media/${postId}/info/`, IG_BASE_URL);
    try {
        let response = await fetch(apiURL.href, getFetchOptions());
        if (response.status === 400) {
            console.log('Post ID conversion failed');
            return null;
        }
        if (!response.ok) {
            console.error('API error:', response.status);
            return null;
        }
        const json = await response.json();
        return json.items[0];
    } catch (error) {
        console.error('Error fetching post data:', error);
        return null;
    }
}

async function getVideoUrl(shortcode) {
    try {
        console.log('Fetching video URL for shortcode:', shortcode);
        const mediaData = await getPostPhotos(shortcode);
        if (!mediaData) {
            console.log('No media data returned');
            return null;
        }

        // Check carousel media first
        if (mediaData.carousel_media && mediaData.carousel_media.length > 0) {
            for (const item of mediaData.carousel_media) {
                if (item.media_type !== 1 && item.video_versions && item.video_versions[0]) {
                    console.log('Found video in carousel');
                    return item.video_versions[0].url;
                }
            }
        }

        // Check main media
        if (mediaData.media_type !== 1 && mediaData.video_versions && mediaData.video_versions[0]) {
            console.log('Found video in main media');
            return mediaData.video_versions[0].url;
        }

        console.log('No video found in media data');
        return null;
    } catch (error) {
        console.error('Error getting video URL:', error);
        return null;
    }
}

// --- VIDEO DETECTION & BUTTON INJECTION ---
const videoObserver = new MutationObserver(() => { checkForVideos(); });
videoObserver.observe(document.body, { childList: true, subtree: true });

function checkForVideos() {
    const videos = document.querySelectorAll('video');
    const path = window.location.pathname;
    const isReelsPage = path === '/reels/' || path.startsWith('/reels/');
    const isPostPage = path.match(/^\/(p|reel|reels)\//);
    const isDirectPage = path.startsWith('/direct/');
    const isStoriesPage = path.startsWith('/stories/');
    
    videos.forEach(video => {
        const container = video.parentElement;
        // If we've already processed this video, skip
        if (video.dataset && (video.dataset.instaProcessed === '1' || container && container.dataset && container.dataset.instaType === 'story')) return;
        
        // On /stories/ page, let story handler take care of it (skip post/reel controls)
        if (isStoriesPage) {
            try { video.dataset.instaProcessed = '1'; if (container) container.dataset.instaType = 'story'; } catch (e) {}
            return;
        }
        
        // On /reels/ page or post pages or direct messages, don't treat videos as stories - treat them as posts/reels
        let isStoryLike = false;
        if (!isReelsPage && !isPostPage && !isDirectPage) {
            // Check if this video is part of a post/reel by looking for shortcode links nearby
            const hasPostLink = container && (
                container.querySelector('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]') ||
                container.closest('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]')
            );
            
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
                            const isFixed = cs.position === 'fixed' || cs.position === 'sticky';
                            const hasDialogRole = (anc.getAttribute && ((anc.getAttribute('role') || '').toLowerCase() === 'dialog' || anc.getAttribute('aria-modal') === 'true'));
                            const className = (anc.className || '').toString().toLowerCase();
                            const hasStoryClass = className.includes('story') || className.includes('stories') || className.includes('viewer') || className.includes('modal');

                            // require either dialog/modal role or fixed positioning with large coverage
                            if (hasDialogRole || (isFixed && (aRect.width > window.innerWidth * 0.6 || aRect.height > window.innerHeight * 0.6)) || hasStoryClass) {
                                isStoryLike = true;
                                break;
                            }
                            anc = anc.parentElement;
                        }

                        // fallback: only treat as story if video itself covers most of viewport
                        if (!isStoryLike && (rect.width > window.innerWidth * 0.75 || rect.height > window.innerHeight * 0.75)) isStoryLike = true;
                    }
                } catch (e) { /* ignore */ }
            }
        }
        // If it's a story-like video (and not on /reels/ page, post page, or direct messages), don't inject the post/reel panels here — story toolbar handles it.
        if (isStoryLike) {
            // mark as processed as story so other code won't add duplicate controls
            try { video.dataset.instaProcessed = '1'; if (container) container.dataset.instaType = 'story'; } catch (e) {}
            return;
        }

        if(getComputedStyle(container).position === 'static') container.style.position = 'relative';

        container.classList.add('insta-hover-box');
        hideNativeOverlays(container);

        if (container.querySelector('.insta-master-controls')) return;

        if(USER_WANTS_AUDIO) {
            video.muted = false;
            video.volume = USER_VOLUME_LEVEL;
        }

        video.addEventListener('volumechange', (e) => {
            if (IS_DRAGGING_VOLUME) return;
            if (USER_WANTS_AUDIO && (video.muted || video.volume === 0)) {
                video.muted = false;
                video.volume = USER_VOLUME_LEVEL;
            }
        });

        addTopButtons(container, video);
        addBottomControls(container, video);
        // mark processed so story observer / other injectors skip
        try { video.dataset.instaProcessed = '1'; if (container) container.dataset.instaType = 'post'; } catch (e) {}
    });
}

function hideNativeOverlays(container) {
    const potentialButtons = container.querySelectorAll('button, div[role="button"]');
    potentialButtons.forEach(btn => {
        if(btn.closest('.insta-master-controls') || btn.closest('.insta-bottom-panel')) return;
        const label = (btn.ariaLabel || "").toLowerCase();
        if(label.includes('ses') || label.includes('audio') || label.includes('mute') || label.includes('voice')) {
            btn.style.display = 'none';
        }
    });
}

function addTopButtons(container, video) {
    // Do not add post/reel top buttons if this container is marked as a story
    try { if (container && container.dataset && container.dataset.instaType === 'story') return; } catch(e) {}
    const panel = document.createElement('div');
    panel.className = 'insta-master-controls';

    const btnSpeed = createButton('1x', () => {
        if(video.playbackRate === 1) video.playbackRate = 1.5;
        else if(video.playbackRate === 1.5) video.playbackRate = 2;
        else video.playbackRate = 1;
        btnSpeed.innerText = video.playbackRate + 'x';
    });

    const btnDownload = document.createElement('div');
    btnDownload.className = 'insta-master-btn';
    btnDownload.style.padding = "0";
    btnDownload.style.width = "30px";
    btnDownload.style.justifyContent = "center";
    btnDownload.innerHTML = SVG_DOWNLOAD;
    const dlSvg = btnDownload.querySelector('svg');
    if(dlSvg) { dlSvg.style.width = "18px"; dlSvg.style.height = "18px"; }

    // --- DOWNLOAD HANDLER ---
    btnDownload.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();

        btnDownload.innerHTML = SVG_LOADING;
        const loadSvg = btnDownload.querySelector('svg');
        if(loadSvg) { loadSvg.style.width = "18px"; loadSvg.style.height = "18px"; }

        try {
            let shortcode = findShortcode(container);
            const path = window.location.pathname || '';
            // On /reels/, /direct/, or post pages, try finding shortcode from video element itself if container search failed
            if (!shortcode && (path === '/reels/' || path.startsWith('/reels/') || path.startsWith('/direct/') || path.match(/^\/(p|reel|reels)\//))) {
                shortcode = findShortcode(video);
            }
            if (!shortcode) {
                throw new Error('Could not find post ID');
            }

            console.log('Found shortcode:', shortcode);
            const videoUrl = await getVideoUrl(shortcode);

            if (!videoUrl) {
                throw new Error('Could not extract video URL from Instagram API');
            }

            console.log('Got video URL from API:', videoUrl);
            chrome.runtime.sendMessage({ action: "download_final", url: videoUrl });
            showSuccess(btnDownload);

        } catch (err) {
            console.error('Download error:', err);
            showError(btnDownload, err.message || 'Download failed');
        }
    };

    const btnFullscreen = document.createElement('div');
    btnFullscreen.className = 'insta-master-btn';
    btnFullscreen.style.padding = "0";
    btnFullscreen.style.width = "30px";
    btnFullscreen.style.justifyContent = "center";

    const updateIcon = () => {
        let iconHTML = document.fullscreenElement ? SVG_FULLSCREEN_EXIT : SVG_FULLSCREEN_ENTER;
        btnFullscreen.innerHTML = iconHTML;
        const svg = btnFullscreen.querySelector('svg');
        if(svg) { svg.style.width = "18px"; svg.style.height = "18px"; }
    };
    updateIcon();

    btnFullscreen.onclick = (e) => {
        e.stopPropagation();
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            if (container.requestFullscreen) {
                container.requestFullscreen();
                container.style.display = 'flex';
                container.style.alignItems = 'center';
                container.style.justifyContent = 'center';
                container.style.background = '#000';
            } else if (container.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            }
        }
    };

    document.addEventListener('fullscreenchange', () => {
        updateIcon();
        if (!document.fullscreenElement) {
            container.style.display = '';
            container.style.alignItems = '';
            container.style.justifyContent = '';
            container.style.background = '';
        }
    });

    panel.appendChild(btnSpeed);
    panel.appendChild(btnDownload);
    panel.appendChild(btnFullscreen);
    container.appendChild(panel);
    try { container.dataset.instaType = 'post'; } catch(e) {}
}

function showSuccess(btn) {
    setTimeout(() => {
        btn.innerHTML = SVG_DOWNLOAD;
        btn.style.backgroundColor = "#28a745";
        const s = btn.querySelector('svg'); if(s) { s.style.width="18px"; s.style.height="18px"; }
        setTimeout(() => { btn.style.backgroundColor = ""; }, 1500);
    }, 500);
}

function showError(btn, msg) {
    btn.innerHTML = SVG_DOWNLOAD;
    btn.style.backgroundColor = "#dc3545";
    alert(msg);
    const s = btn.querySelector('svg'); if(s) { s.style.width="18px"; s.style.height="18px"; }
    setTimeout(() => { btn.style.backgroundColor = ""; }, 1500);
}

function addBottomControls(container, video) {
    // Do not add post/reel bottom controls if this container is marked as a story
    try { if (container && container.dataset && container.dataset.instaType === 'story') return; } catch(e) {}
    const bottomPanel = document.createElement('div');
    bottomPanel.className = 'insta-bottom-panel';

    const playBtn = document.createElement('div');
    playBtn.className = 'insta-icon-svg';
    playBtn.innerHTML = video.paused ? SVG_PLAY : SVG_PAUSE;

    playBtn.onclick = (e) => {
        e.stopPropagation();
        if(video.paused) {
            video.play();
            video.muted = false;
            video.volume = USER_VOLUME_LEVEL;
        } else {
            video.pause();
        }
    };

    video.addEventListener('play', () => { playBtn.innerHTML = SVG_PAUSE; });
    video.addEventListener('pause', () => { playBtn.innerHTML = SVG_PLAY; });

    // Prevent pause when tab is hidden - keep playing in background
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Tab is hidden - do nothing, let video keep playing
            console.log('Tab hidden, video continues playing');
        } else {
            // Tab is visible again - do nothing, video state unchanged
            console.log('Tab visible again');
        }
    });

    const seekSlider = document.createElement('input');
    seekSlider.type = 'range';
    seekSlider.id = 'seek-slider';
    seekSlider.min = 0;
    seekSlider.max = 100;
    seekSlider.value = 0;

    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'insta-time-text';
    timeDisplay.innerText = "00:00 / 00:00";

    const volIcon = document.createElement('div');
    volIcon.className = 'insta-icon-svg';
    volIcon.style.width = "20px";
    volIcon.innerHTML = SVG_VOLUME_UP;

    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.id = 'volume-slider';
    volumeSlider.min = 0;
    volumeSlider.max = 1;
    volumeSlider.step = 0.05;
    volumeSlider.value = USER_VOLUME_LEVEL;

    const updateUI = () => {
        volIcon.innerHTML = USER_WANTS_AUDIO ? SVG_VOLUME_UP : SVG_VOLUME_MUTE;
        volumeSlider.value = USER_WANTS_AUDIO ? USER_VOLUME_LEVEL : 0;
    };
    updateUI();

    volumeSlider.addEventListener('mousedown', () => { IS_DRAGGING_VOLUME = true; });
    volumeSlider.addEventListener('mouseup', () => { IS_DRAGGING_VOLUME = false; });
    volumeSlider.addEventListener('touchstart', () => { IS_DRAGGING_VOLUME = true; });
    volumeSlider.addEventListener('touchend', () => { IS_DRAGGING_VOLUME = false; });

    volumeSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = parseFloat(e.target.value);

        if(val > 0) {
            USER_WANTS_AUDIO = true;
            USER_VOLUME_LEVEL = val;
            video.muted = false;
            video.volume = val;
        } else {
            USER_WANTS_AUDIO = false;
            video.muted = true;
        }
        updateUI();
    });

    // Mouse wheel scroll support for volume adjustment
    volumeSlider.addEventListener('wheel', (e) => {
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
        
        if(newVal > 0) {
            USER_WANTS_AUDIO = true;
            USER_VOLUME_LEVEL = newVal;
            video.muted = false;
            video.volume = newVal;
        } else {
            USER_WANTS_AUDIO = false;
            video.muted = true;
        }
        updateUI();
    }, { passive: false });

    volIcon.onclick = (e) => {
        e.stopPropagation();
        USER_WANTS_AUDIO = !USER_WANTS_AUDIO;
        if(USER_WANTS_AUDIO) {
            video.muted = false;
            video.volume = USER_VOLUME_LEVEL > 0 ? USER_VOLUME_LEVEL : 0.5;
        } else {
            video.muted = true;
        }
        updateUI();
    };

    video.addEventListener('timeupdate', () => {
        if (!isNaN(video.duration)) {
            seekSlider.max = video.duration;
            seekSlider.value = video.currentTime;
            timeDisplay.innerText = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
        }
    });

    seekSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        video.currentTime = e.target.value;
    });

    bottomPanel.appendChild(playBtn);
    bottomPanel.appendChild(seekSlider);
    bottomPanel.appendChild(timeDisplay);
    bottomPanel.appendChild(volIcon);
    bottomPanel.appendChild(volumeSlider);

    container.appendChild(bottomPanel);
    try { container.dataset.instaType = 'post'; } catch(e) {}
}

// formatTime() and createButton() moved to content/utils.js (loaded earlier via manifest)


// Listen for download failure messages from background
chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || !msg.action) return;
    if (msg.action === 'download_failed') {
        alert('Download failed: ' + (msg.message || 'Unknown error'));
    }
});

// --- STORY VIDEO HANDLER ---
// Detect story-like videos (fixed-position modal) and add a floating toolbar
(() => {
    const TOOLBAR_Z = 2147483647;
    let active = null; // { video, toolbar, repositionHandler, removalObserver }

    function isLikelyStoryVideo(video) {
        try {
            const path = window.location.pathname || '';
            
            // Explicitly treat videos on /stories/ pages as stories
            if (path.startsWith('/stories/')) {
                return true;
            }
            
            // Don't treat videos on /reels/, /p/, /reel/, /direct/ pages as stories
            if (path === '/reels/' || path.startsWith('/reels/') || 
                path.match(/^\/(p|reel|reels)\//) || 
                path.startsWith('/direct/')) {
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
                const isFixed = cs.position === 'fixed' || cs.position === 'sticky';
                const role = (anc.getAttribute && (anc.getAttribute('role') || '').toLowerCase()) || '';
                const ariaModal = anc.getAttribute && anc.getAttribute('aria-modal');
                const className = (anc.className || '').toString().toLowerCase();
                const hasStoryClass = className.includes('story') || className.includes('stories') || className.includes('viewer') || className.includes('modal');

                if (role === 'dialog' || ariaModal === 'true' || hasStoryClass || (isFixed && (aRect.width > window.innerWidth * 0.6 || aRect.height > window.innerHeight * 0.6))) {
                    found = true;
                    break;
                }
                anc = anc.parentElement;
            }

            // fallback: treat as story only if it covers a very large portion of viewport
            if (!found && (rect.width > window.innerWidth * 0.9 || rect.height > window.innerHeight * 0.9)) found = true;

            // If URL indicates a reel/post, prefer NOT to treat as story unless explicit dialog/modal markers exist
            if (found) {
                if ((/\/(reel|reels|p)\//i).test(path)) {
                    // check explicitly for dialog/aria-modal in ancestors; if not present, don't mark
                    let explicit = false;
                    let a2 = video.parentElement;
                    while (a2 && a2 !== document.body) {
                        const role2 = (a2.getAttribute && (a2.getAttribute('role') || '').toLowerCase()) || '';
                        const aria2 = a2.getAttribute && a2.getAttribute('aria-modal');
                        if (role2 === 'dialog' || aria2 === 'true') { explicit = true; break; }
                        a2 = a2.parentElement;
                    }
                    if (!explicit) return false;
                }
            }

            return !!found;
        } catch (e) {
            console.warn('isLikelyStoryVideo error', e);
            return false;
        }
    }

    function createToolbarElements() {
        const toolbar = document.createElement('div');
        toolbar.className = 'insta-story-toolbar';
        Object.assign(toolbar.style, {
            position: 'fixed',
            zIndex: String(TOOLBAR_Z),
            pointerEvents: 'auto',
            display: 'flex',
            gap: '8px',
            padding: '6px',
            borderRadius: '8px',
            background: 'rgba(0,0,0,0.45)',
            alignItems: 'center',
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)'
        });

        const btn = (html, title) => {
            const d = document.createElement('button');
            d.className = 'insta-story-btn';
            d.innerHTML = html;
            d.title = title || '';
            Object.assign(d.style, {
                background: 'transparent',
                border: 'none',
                color: '#fff',
                width: '34px',
                height: '34px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
            });
            return d;
        };

        const downloadBtn = btn(SVG_DOWNLOAD, 'Download story');
        const playBtn = btn(SVG_PLAY, 'Play/Pause');

        toolbar.appendChild(playBtn);
        toolbar.appendChild(downloadBtn);

        return { toolbar, downloadBtn, playBtn };
    }

    function positionToolbarForVideo(toolbar, video) {
        try {
            // Ensure toolbar has proper dimensions first
            if (toolbar.offsetWidth === 0 || toolbar.offsetHeight === 0) {
                // Force layout calculation
                toolbar.style.display = 'flex';
                void toolbar.offsetWidth; // Force reflow
            }
            
            // For stories, place toolbar at top-right corner of viewport (safer and always visible)
            const path = window.location.pathname || '';
            if (path.startsWith('/stories/')) {
                // Fixed position at top-right corner, but offset left to avoid Instagram's X button
                // Instagram's X button is usually around 16px from right, so we'll place toolbar more to the left
                toolbar.style.right = '580px'; // More left to avoid X button
                toolbar.style.top = '16px';
                toolbar.style.left = 'auto';
                toolbar.style.bottom = 'auto';
            } else {
                // For other story-like videos, position relative to video
                const rect = video.getBoundingClientRect();
                const margin = 12;
                let left = rect.right - toolbar.offsetWidth - margin;
                let top = rect.top + margin;
                
                // Clamp to viewport
                left = Math.max(8, Math.min(left, window.innerWidth - toolbar.offsetWidth - 8));
                top = Math.max(8, Math.min(top, window.innerHeight - toolbar.offsetHeight - 8));
                
                toolbar.style.left = left + 'px';
                toolbar.style.top = top + 'px';
                toolbar.style.right = 'auto';
                toolbar.style.bottom = 'auto';
            }
            
            toolbar.style.display = 'flex';
            toolbar.style.visibility = 'visible';
            toolbar.style.opacity = '1';
            
            console.log('Toolbar positioned. Video rect:', video.getBoundingClientRect());
        } catch (e) {
            console.error('Error positioning toolbar', e);
        }
    }

    function attachToVideo(video) {
        if (active && active.video === video) return;
        detachActive();

        const { toolbar, downloadBtn, playBtn } = createToolbarElements();
        
        // Always append to body for maximum visibility and to avoid z-index/container issues
        document.body.appendChild(toolbar);
        console.log('Story toolbar created and attached to body');

        const reposition = () => {
            if (document.body.contains(video) && (toolbar.parentElement || document.body.contains(toolbar))) {
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
                const svg = playBtn.querySelector('svg');
                if(svg) { 
                    svg.style.width = "18px"; 
                    svg.style.height = "18px"; 
                }
                console.log('Play button icon updated, video paused:', isPaused);
            } catch (err) {
                console.error('Error updating play button icon', err);
            }
        };
        
        // Set initial icon
        updatePlayButtonIcon();
        
        // Update icon when video play/pause state changes
        const playHandler = () => {
            console.log('Video play event');
            updatePlayButtonIcon();
        };
        const pauseHandler = () => {
            console.log('Video pause event');
            updatePlayButtonIcon();
        };
        
        video.addEventListener('play', playHandler);
        video.addEventListener('pause', pauseHandler);
        video.addEventListener('playing', playHandler);
        video.addEventListener('waiting', pauseHandler);
        
        // play/pause button click handler
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            try {
                console.log('Play button clicked, current paused state:', video.paused);
                if (video.paused) {
                    console.log('Attempting to play video');
                    const playPromise = video.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            console.log('Video play() successful');
                            updatePlayButtonIcon();
                        }).catch(err => {
                            console.error('Video play() failed', err);
                            // Try clicking the video element itself
                            video.click();
                            updatePlayButtonIcon();
                        });
                    }
                } else {
                    console.log('Attempting to pause video');
                    video.pause();
                    updatePlayButtonIcon();
                }
            } catch (err) {
                console.error('Error in play/pause handler', err);
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

        // download handler: use Instagram-Downloader-main method for stories
        downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            const path = window.location.pathname || '';
            const isStoriesPage = path.startsWith('/stories/');
            
            // Show loading state
            const originalHTML = downloadBtn.innerHTML;
            downloadBtn.innerHTML = SVG_LOADING;
            const loadSvg = downloadBtn.querySelector('svg');
            if(loadSvg) { loadSvg.style.width = "18px"; loadSvg.style.height = "18px"; }
            
            try {
                // For stories, use API method (like Instagram-Downloader-main)
                if (isStoriesPage) {
                    console.log('Attempting to download story video via API...');
                    const videoUrl = await getStoryVideoUrl();
                    if (videoUrl) {
                        console.log('Story video URL from API:', videoUrl);
                        chrome.runtime.sendMessage({ action: 'download_final', url: videoUrl });
                        downloadBtn.innerHTML = originalHTML;
                        return;
                    }
                    console.log('API method failed, trying direct video URL...');
                }
                
                // Try multiple methods to get video URL directly from video element
                let videoUrl = null;
                
                // Method 1: Try currentSrc (most reliable for playing videos)
                if (video.currentSrc && !video.currentSrc.startsWith('blob:') && !video.currentSrc.startsWith('data:')) {
                    videoUrl = video.currentSrc;
                }
                
                // Method 2: Try src attribute
                if (!videoUrl && video.src && !video.src.startsWith('blob:') && !video.src.startsWith('data:')) {
                    videoUrl = video.src;
                }
                
                // Method 3: Try source elements
                if (!videoUrl) {
                    const sourceElements = Array.from(video.querySelectorAll && video.querySelectorAll('source') || []);
                    for (const source of sourceElements) {
                        if (source.src && !source.src.startsWith('blob:') && !source.src.startsWith('data:')) {
                            videoUrl = source.src;
                            break;
                        }
                    }
                }
                
                // Use direct video URL if found
                if (videoUrl) {
                    console.log('Direct video URL found:', videoUrl);
                    chrome.runtime.sendMessage({ action: 'download_final', url: videoUrl });
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
                            chrome.runtime.sendMessage({ action: 'download_final', url });
                            downloadBtn.innerHTML = originalHTML;
                            return;
                        }
                    }
                }

                throw new Error('Bu hikaye videosu için indirme adresi bulunamadı.');
            } catch (err) {
                console.error('Story download error', err);
                downloadBtn.innerHTML = originalHTML;
                alert('Hikaye indirilemedi: ' + (err.message || 'Unknown error'));
            }
        });

        // reposition on scroll/resize
        const onWindowChange = () => reposition();
        window.addEventListener('resize', onWindowChange);
        window.addEventListener('scroll', onWindowChange, true);
        
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
        try { video.dataset.instaProcessed = '1'; if (video.parentElement) video.parentElement.dataset.instaType = 'story'; } catch (e) {}
        
        // Store video event listeners so we can clean them up later
        const videoEventListeners = {
            play: playHandler,
            pause: pauseHandler,
            playing: playHandler,
            waiting: pauseHandler
        };
        active = { video, toolbar, repositionHandler: onWindowChange, removalObserver, repositionInterval, videoEventListeners };
    }

    function detachActive() {
        if (!active) return;
        try {
            window.removeEventListener('resize', active.repositionHandler);
            window.removeEventListener('scroll', active.repositionHandler, true);
            if (active.repositionInterval) {
                clearInterval(active.repositionInterval);
            }
            // Remove video event listeners
            if (active.video && active.videoEventListeners) {
                active.video.removeEventListener('play', active.videoEventListeners.play);
                active.video.removeEventListener('pause', active.videoEventListeners.pause);
                active.video.removeEventListener('playing', active.videoEventListeners.playing);
                active.video.removeEventListener('waiting', active.videoEventListeners.waiting);
            }
            active.removalObserver.disconnect();
            if (active.toolbar && active.toolbar.parentElement) active.toolbar.parentElement.removeChild(active.toolbar);
            try { if (active.video) { delete active.video.dataset.instaProcessed; if (active.video.parentElement) delete active.video.parentElement.dataset.instaType; } } catch(e) {}
        } catch (e) { /* ignore */ }
        active = null;
    }

    // Observe added/changed video elements and attach toolbar when a story-like video appears
    const storyObserver = new MutationObserver(() => {
        const path = window.location.pathname || '';
        const isStoriesPage = path.startsWith('/stories/');
        
        // Find all potential story videos
        const videos = Array.from(document.querySelectorAll('video'));
        let storyVideo = null;
        
        for (const v of videos) {
            // Skip if already processed by main injector as post/reel
            if (v.dataset && v.dataset.instaProcessed === '1') {
                // Check if it's marked as story or if we should override
                const container = v.parentElement;
                if (container && container.dataset && container.dataset.instaType === 'story') {
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
                    storyVideo.dataset.instaProcessed = '1'; 
                    if (storyVideo.parentElement) storyVideo.parentElement.dataset.instaType = 'story'; 
                } catch(e) {}
                attachToVideo(storyVideo);
            }
        } else if (!isStoriesPage) {
            // Only cleanup if we're not on stories page (videos might be loading)
            detachActive();
        }
    });
    storyObserver.observe(document.body, { childList: true, subtree: true, attributes: true });

    // initial scan for stories on page load
    function initialStoryScan() {
        const videos = Array.from(document.querySelectorAll('video'));
        for (const v of videos) {
            // Skip if already processed by main injector as post/reel
            if (v.dataset && v.dataset.instaProcessed === '1') {
                const container = v.parentElement;
                if (container && container.dataset && container.dataset.instaType === 'story') {
                    if (isLikelyStoryVideo(v)) {
                        try { v.dataset.instaProcessed = '1'; if (v.parentElement) v.parentElement.dataset.instaType = 'story'; } catch(e) {}
                        attachToVideo(v);
                        return;
                    }
                }
                continue;
            }
            
            if (isLikelyStoryVideo(v)) {
                try { v.dataset.instaProcessed = '1'; if (v.parentElement) v.parentElement.dataset.instaType = 'story'; } catch(e) {}
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
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runScans);
    } else {
        runScans();
    }
    
    // Also run scans periodically on stories pages to catch video changes
    const path = window.location.pathname || '';
    if (path.startsWith('/stories/')) {
        setInterval(() => {
            if (!active) {
                initialStoryScan();
            }
        }, 1500);
    }
    
})();
