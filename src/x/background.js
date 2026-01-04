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

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaultSettings()
})

async function ensureDefaultSettings() {
  const current = await chrome.storage.sync.get(SETTINGS_KEY)
  if (!current[SETTINGS_KEY]) {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS })
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message || {}

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
})

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
      id: `videoman-${Date.now()}`,
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
    createdAt: Date.now(),
    referenceId: data.result,
  })

  return { method: 'aria2', referenceId: data.result }
}