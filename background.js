// Twitter/X settings and history constants
const SETTINGS_KEY = 'settings'
const HISTORY_KEY = 'downloadHistory'
const DEFAULT_SETTINGS = {
  autoRevealSensitive: true,
  useAria2: false,
  aria2Url: 'http://127.0.0.1:6800/jsonrpc',
  aria2Secret: '',
  preferAria2ForVideos: false,
}
const MAX_HISTORY = 200

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(() => {
  ensureDefaultSettings()
})

async function ensureDefaultSettings() {
  const current = await chrome.storage.sync.get(SETTINGS_KEY)
  if (!current[SETTINGS_KEY]) {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS })
  }
}

// Twitter/X settings and history functions
async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) }
}

async function saveSettings(nextSettings) {
  const merged = { ...(await getSettings()), ...nextSettings }
  await chrome.storage.sync.set({ [SETTINGS_KEY]: merged })
  return merged
}

async function getHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY)
  return stored[HISTORY_KEY] || []
}

async function addHistoryEntry(entry) {
  const history = await getHistory()
  const items = [entry, ...history].slice(0, MAX_HISTORY)
  await chrome.storage.local.set({ [HISTORY_KEY]: items })
}

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY)
}

async function sendToBrowserDownloads(item, tweetId) {
  const downloadId = await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: item.url,
        filename: item.filename,
        conflictAction: 'uniquify',
        saveAs: false,
      },
      id => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve(id)
      }
    )
  })

  await addHistoryEntry({
    id: crypto.randomUUID(),
    tweetId: tweetId || null,
    url: item.url,
    filename: item.filename,
    method: 'browser',
    source: 'twitter',
    createdAt: Date.now(),
    referenceId: downloadId,
  })

  return { method: 'browser', referenceId: downloadId }
}

async function sendToAria2(item, settings, tweetId) {
  const aria2Params = []
  if (settings.aria2Secret) {
    aria2Params.push(`token:${settings.aria2Secret}`)
  }
  aria2Params.push([item.url])
  aria2Params.push({
    out: item.filename.split('/').pop(),
  })

  const response = await fetch(settings.aria2Url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `twitterex-${Date.now()}`,
      method: 'aria2.addUri',
      params: aria2Params,
    }),
  })

  if (!response.ok) {
    throw new Error(`Aria2 isteği başarısız: ${response.status}`)
  }

  const data = await response.json()
  if (data.error) {
    throw new Error(data.error?.message || 'Aria2 hatası oluştu.')
  }

  await addHistoryEntry({
    id: crypto.randomUUID(),
    tweetId: tweetId || null,
    url: item.url,
    filename: item.filename,
    method: 'aria2',
    source: 'twitter',
    createdAt: Date.now(),
    referenceId: data.result,
  })

  return { method: 'aria2', referenceId: data.result }
}

async function handleStartDownload(payload) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error('İndirilecek medya bulunamadı.')
  }

  const settings = await getSettings()
  const results = []
  for (const item of payload.items) {
    const shouldUseAria2 =
      settings.useAria2 &&
      (!settings.preferAria2ForVideos || item.mediaType === 'video')

    const result =
      shouldUseAria2
        ? await sendToAria2(item, settings, payload.tweetId)
        : await sendToBrowserDownloads(item, payload.tweetId)

    results.push(result)
  }

  return results
}

// Helper function to extract filename from URL
function extractFilenameFromUrl(url, defaultName) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    if (filename && filename.includes('.')) {
      return filename;
    }
  } catch (e) {
    // URL parsing failed
  }
  return defaultName;
}

// Main message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Instagram download handler
  if (request.action === "download_final") {
    const url = request.url;
    console.log('background: download requested', url);

    // Eğer gönderilen URL bir blob: veya data: URL'siyse, service worker bunları fetch'leyemez.
    if (typeof url === 'string' && (url.startsWith('blob:') || url.startsWith('data:'))) {
      console.warn('background: received blob/data URL; cannot fetch in service worker. Notifying tab.');
      if (sender && sender.tab && typeof sender.tab.id === 'number') {
        chrome.tabs.sendMessage(sender.tab.id, { action: 'download_failed', message: 'blob_or_data_url' });
      }
      return;
    }

    // Determine file extension and create filename
    const isVideo = url.includes('.mp4') || url.includes('video') || url.includes('video_versions');
    const extension = isVideo ? '.mp4' : '.jpg';
    const defaultFilename = `insta_${isVideo ? 'video' : 'photo'}_${Date.now()}${extension}`;
    const filename = extractFilenameFromUrl(url, defaultFilename);

    (async () => {
      let downloadId = null;
      try {
        // Öncelikle arka planda fetch ile içeriği almaya çalış (timeout ile)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const resp = await fetch(url, { 
          credentials: 'include', 
          redirect: 'follow', 
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.instagram.com/'
          }
        });
        clearTimeout(timeout);
        
        if (resp && resp.ok) {
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);

          downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download({
              url: blobUrl,
              filename: filename,
              saveAs: true
            }, (id) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(id);
              }
            });
          });

          // Add to history
          await addHistoryEntry({
            id: crypto.randomUUID(),
            url: url,
            filename: filename,
            method: 'browser',
            source: 'instagram',
            createdAt: Date.now(),
            referenceId: downloadId,
          });

          console.log('background: blob download succeeded', downloadId);
          // Blob URL'yi biraz sonra serbest bırak
          setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch(e){} }, 15000);
          return;
        } else {
          console.warn('background: fetch returned not-ok', resp && resp.status);
        }
      } catch (err) {
        console.warn('background: fetch error', err && err.message);
      }

      // Eğer fetch başarısız olduysa veya blob yöntemi işe yaramadı, doğrudan downloads API ile dene
      console.log('background: attempting direct download via chrome.downloads API');
      downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download({
          url,
          filename: filename,
          saveAs: true
        }, (id) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(id);
          }
        });
      });

      // Add to history
      await addHistoryEntry({
        id: crypto.randomUUID(),
        url: url,
        filename: filename,
        method: 'browser',
        source: 'instagram',
        createdAt: Date.now(),
        referenceId: downloadId,
      });

      console.log('background: direct download started', downloadId);
    })().catch((error) => {
      console.error('background: download failed', error);
      if (sender && sender.tab && typeof sender.tab.id === 'number') {
        chrome.tabs.sendMessage(sender.tab.id, { action: 'download_failed', message: error.message || 'İndirme hatası' });
      }
    });
    return;
  }

  // Twitter/X message handlers
  const { type, payload } = request || {};

  switch (type) {
    case 'start-download':
      handleStartDownload(payload)
        .then(result => sendResponse({ ok: true, result }))
        .catch(error => sendResponse({ ok: false, error: error?.message }))
      return true
    case 'get-settings':
      getSettings()
        .then(settings => sendResponse({ ok: true, settings }))
        .catch(error => sendResponse({ ok: false, error: error?.message }))
      return true
    case 'save-settings':
      saveSettings(payload?.settings || {})
        .then(settings => sendResponse({ ok: true, settings }))
        .catch(error => sendResponse({ ok: false, error: error?.message }))
      return true
    case 'get-history':
      getHistory()
        .then(history => sendResponse({ ok: true, history }))
        .catch(error => sendResponse({ ok: false, error: error?.message }))
      return true
    case 'clear-history':
      clearHistory()
        .then(() => sendResponse({ ok: true }))
        .catch(error => sendResponse({ ok: false, error: error?.message }))
      return true
    default:
      break
  }

  return false
});