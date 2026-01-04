const BUTTON_FLAG = 'data-videoman-downloader'
const INJECTED_SCRIPT_ID = 'videoman-injected-script'
const GRAPHQL_MESSAGE = 'videoman:graphql'
const ACTION_GROUP_SELECTOR = 'div[role="group"]'
const DEFAULT_SETTINGS = {
  autoRevealSensitive: true,
  useAria2: false,
  preferAria2ForVideos: false,
}
const DOWNLOAD_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="twitter-download-icon" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
</svg>`
const mediaCache = new Map()
let currentSettings = { ...DEFAULT_SETTINGS }
let initialized = false

bootstrap()

function bootstrap() {
  Promise.all([loadSettings(), injectPageScript()]).then(() => {
    if (initialized) return
    initialized = true
    observeTimeline()
    scanForTweets(document)
    window.addEventListener('message', handleGraphQLMessage, false)
    chrome.storage.onChanged.addListener(handleStorageChange)
  })
}

function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['settings'], data => {
      currentSettings = {
        ...DEFAULT_SETTINGS,
        ...(data?.settings || {}),
      }
      resolve(currentSettings)
    })
  })
}

function handleStorageChange(changes, areaName) {
  if (areaName !== 'sync' || !changes.settings) return
  currentSettings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) }
}

function injectPageScript() {
  return new Promise(resolve => {
    if (document.getElementById(INJECTED_SCRIPT_ID)) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.id = INJECTED_SCRIPT_ID
    script.src = chrome.runtime.getURL('src/x/pageScript.js')
    script.onload = () => script.remove()
    document.documentElement.appendChild(script)
    resolve()
  })
}

function observeTimeline() {
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return
        if (node.matches?.('article')) {
          processTweet(node)
          return
        }
        const articles = node.querySelectorAll?.('article')
        articles?.forEach(article => processTweet(article))
      })
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })
}

function scanForTweets(context) {
  const tweets = context.querySelectorAll?.('article')
  tweets?.forEach(article => processTweet(article))
}

function processTweet(article) {
  if (!(article instanceof HTMLElement)) return
  revealSensitiveContent(article)
  if (article.getAttribute(BUTTON_FLAG)) {
    const buttonExists = article.querySelector('.twitter-download-btn')
    if (buttonExists) return
    article.removeAttribute(BUTTON_FLAG)
  }

  const tweetId = getTweetId(article)

  // Check for media in main tweet and embedded/quoted tweets
  const hasMedia =
    article.querySelector('img[src*="pbs.twimg.com/media"]') ||
    article.querySelector('video') ||
    Boolean(tweetId && mediaCache.has(tweetId)) ||
    // Check for media in embedded/quoted tweets
    article.querySelector('article img[src*="pbs.twimg.com/media"]') ||
    article.querySelector('article video')

  if (!hasMedia) return

  // Find the action group - look for the container with reply/like/retweet buttons
  let actionGroup = article.querySelector(ACTION_GROUP_SELECTOR)
  
  // If multiple groups found, try to find the one with action buttons
  if (!actionGroup || article.querySelectorAll(ACTION_GROUP_SELECTOR).length > 1) {
    const allGroups = article.querySelectorAll(ACTION_GROUP_SELECTOR)
    for (const group of allGroups) {
      // Look for common Twitter action button indicators
      if (group.querySelector('button[data-testid*="reply"], button[data-testid*="like"], button[data-testid*="retweet"], button[aria-label*="Reply"], button[aria-label*="Like"]')) {
        actionGroup = group
        break
      }
    }
    // Fallback to first group if none found with buttons
    if (!actionGroup && allGroups.length > 0) {
      actionGroup = allGroups[0]
    }
  }
  
  if (!actionGroup) {
    waitForActionGroup(article)
    return
  }

  const button = document.createElement('button')
  button.className = 'twitter-download-btn'
  button.type = 'button'
  button.setAttribute('aria-label', 'Medyayı indir')
  button.innerHTML = DOWNLOAD_ICON
  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    handleDownload(article, button)
  })

  actionGroup.appendChild(button)
  article.setAttribute(BUTTON_FLAG, 'true')
}

const ARTICLE_OBSERVER_KEY = '__videoman_action_observer'

function waitForActionGroup(article) {
  if (article[ARTICLE_OBSERVER_KEY]) return

  const observer = new MutationObserver(() => {
    let actionGroup = article.querySelector(ACTION_GROUP_SELECTOR)
    if (actionGroup) {
      // Verify it's the right group
      const allGroups = article.querySelectorAll(ACTION_GROUP_SELECTOR)
      if (allGroups.length > 1) {
        for (const group of allGroups) {
          if (group.querySelector('button[data-testid*="reply"], button[data-testid*="like"], button[aria-label*="Reply"], button[aria-label*="Like"]')) {
            actionGroup = group
            break
          }
        }
      }
      if (actionGroup) {
        observer.disconnect()
        article[ARTICLE_OBSERVER_KEY] = undefined
        processTweet(article)
      }
    }
  })

  observer.observe(article, { childList: true, subtree: true })
  article[ARTICLE_OBSERVER_KEY] = observer
}

function revealSensitiveContent(root) {
  if (!currentSettings.autoRevealSensitive) return

  const warningSelectors = [
    '[data-testid="sensitiveMediaWarning"]',
    '[data-testid="sensitive_media_interstitial"]',
    '[aria-label="Sensitive content"]',
  ]

  warningSelectors.forEach(selector => {
    root.querySelectorAll(selector).forEach(node => {
      const button = node.querySelector('button')
      button?.click()
      node.style.display = 'none'
    })
  })

  root.querySelectorAll('[style*="blur"]').forEach(node => {
    if (node.style.filter?.includes('blur')) {
      node.style.filter = 'none'
    }
  })
}

async function handleDownload(article, button) {
  button.disabled = true
  button.classList.add('is-busy')

  try {
    const tweetId = getTweetId(article) || `tweet-${Date.now()}`
    const media = await resolveMediaCollection(article, tweetId)
    if (!media || (media.images.length === 0 && media.videos.length === 0)) {
      notify('Bu tweette indirilebilir medya bulunamadı.')
      return
    }

    const items = [...media.images, ...media.videos].map((item, index) => ({
      url: item.url,
      mediaType: item.mediaType,
      filename: buildFilename(tweetId, item, index),
    }))

    const response = await sendDownloadRequest(tweetId, items)
    if (!response?.ok) {
      notify('İndirme başlatılırken bir hata oluştu.')
      return
    }
    notify('Medya indiriliyor.')
  } catch (error) {
    console.error('[videoman] download error', error)
    notify('İndirme işlemi başarısız oldu.')
  } finally {
    button.disabled = false
    button.classList.remove('is-busy')
  }
}

function buildFilename(tweetId, item, index) {
  const baseName = tweetId || 'twitter-media'
  const extension = inferExtension(item.url, item.mediaType)
  return `twitter_media/${baseName}-${item.mediaType}-${index + 1}.${extension}`
}

function inferExtension(url, mediaType) {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/)
    if (match) {
      return match[1].split('?')[0]
    }
  } catch {
    // ignore
  }
  return mediaType === 'video' ? 'mp4' : 'jpg'
}

function resolveMediaCollection(article, tweetId) {
  const fromCache = mediaCache.get(tweetId)
  if (fromCache) return Promise.resolve(fromCache)
  return Promise.resolve(extractMediaFromDom(article))
}

function extractMediaFromDom(article) {
  // Find all nested articles (quoted/embedded tweets) first
  // These are articles that are descendants of the main article but not the article itself
  const allArticles = Array.from(article.querySelectorAll('article'))
  const nestedArticles = allArticles.filter(nestedArticle => nestedArticle !== article)

  // Extract media from main tweet (excluding nested articles)
  const mainImages = []
  const mainVideos = []
  
  // Get all images and videos from main article
  const allMainImgs = article.querySelectorAll('img[src*="pbs.twimg.com/media"]')
  const allMainVids = article.querySelectorAll('video')
  
  allMainImgs.forEach(img => {
    // Check if this image is inside a nested article
    const isInNested = nestedArticles.some(nested => nested.contains(img))
    if (!isInNested) {
      mainImages.push({
        url: forceOriginalQuality(img.src),
        mediaType: 'image',
      })
    }
  })
  
  allMainVids.forEach(video => {
    // Check if this video is inside a nested article
    const isInNested = nestedArticles.some(nested => nested.contains(video))
    if (!isInNested && video.src && !video.src.startsWith('blob:')) {
      mainVideos.push({
        url: video.src,
        mediaType: 'video',
      })
    }
  })

  // Extract media from embedded/quoted tweets
  const embeddedImages = []
  const embeddedVideos = []

  nestedArticles.forEach(nestedArticle => {
    // Check if this nested article is actually a quoted/embedded tweet
    // by checking if it has its own tweet link
    const nestedTweetId = getTweetId(nestedArticle)
    if (nestedTweetId) {
      // First check cache for this nested tweet
      const cached = mediaCache.get(nestedTweetId)
      if (cached) {
        embeddedImages.push(...cached.images)
        embeddedVideos.push(...cached.videos)
        return
      }
    }

    // Extract media from nested article DOM
    const nestedImgs = Array.from(
      nestedArticle.querySelectorAll('img[src*="pbs.twimg.com/media"]')
    ).map(img => ({
      url: forceOriginalQuality(img.src),
      mediaType: 'image',
    }))

    const nestedVids = Array.from(nestedArticle.querySelectorAll('video')).reduce(
      (acc, video) => {
        if (video.src && !video.src.startsWith('blob:')) {
          acc.push({
            url: video.src,
            mediaType: 'video',
          })
        }
        return acc
      },
      []
    )

    embeddedImages.push(...nestedImgs)
    embeddedVideos.push(...nestedVids)
  })

  // Combine main and embedded media, remove duplicates
  const allImages = [...mainImages, ...embeddedImages]
  const allVideos = [...mainVideos, ...embeddedVideos]

  // Remove duplicates based on URL
  const uniqueImages = Array.from(
    new Map(allImages.map(img => [img.url, img])).values()
  )
  const uniqueVideos = Array.from(
    new Map(allVideos.map(vid => [vid.url, vid])).values()
  )

  return { images: uniqueImages, videos: uniqueVideos }
}

function forceOriginalQuality(url) {
  try {
    const targetUrl = new URL(url)
    targetUrl.searchParams.set('name', 'orig')
    return targetUrl.toString()
  } catch {
    return url
  }
}

function getTweetId(article) {
  const anchor = article.querySelector('a[href*="/status/"]')
  if (!anchor) return null
  const match = anchor.href.match(/status\/(\d+)/)
  return match ? match[1] : null
}

function sendDownloadRequest(tweetId, items) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      {
        type: 'start-download',
        payload: {
          tweetId,
          items,
        },
      },
      response => {
        if (chrome.runtime.lastError) {
          console.error('[videoman] sendMessage error', chrome.runtime.lastError)
          resolve({ ok: false })
          return
        }
        resolve(response)
      }
    )
  })
}

function handleGraphQLMessage(event) {
  if (event.source !== window) return
  const data = event.data
  if (!data || data.source !== 'videoman:injector') return
  if (data.type !== GRAPHQL_MESSAGE) return
  if (!data.detail?.body) return

  try {
    const payload = JSON.parse(data.detail.body)
    extractMediaFromGraphQL(payload)
  } catch (error) {
    console.error('[videoman] GraphQL parse error', error)
  }
}

function extractMediaFromGraphQL(payload) {
  traverse(payload, node => {
    if (!node || typeof node !== 'object') return
    const legacy = node.legacy
    if (!legacy) return
    const media = legacy.extended_entities?.media
    if (!Array.isArray(media) || media.length === 0) return

    const tweetId =
      node.rest_id ||
      node.tweet_id ||
      node.tweetId ||
      legacy.id_str ||
      legacy.conversation_id_str
    if (!tweetId) return

    const collection = normalizeMedia(media)
    if (collection.images.length === 0 && collection.videos.length === 0)
      return
    mediaCache.set(tweetId, collection)
    refreshArticlesForTweet(tweetId)
  })
}

function refreshArticlesForTweet(tweetId) {
  if (!tweetId) return
  const selector = `article a[href*="/status/${tweetId}"]`
  const anchors = document.querySelectorAll(selector)
  anchors.forEach(anchor => {
    const article = anchor.closest('article')
    if (!article) return
    const button = article.querySelector('.twitter-download-btn')
    if (button) return
    article.removeAttribute(BUTTON_FLAG)
    processTweet(article)
  })
}

function normalizeMedia(mediaList) {
  const images = []
  const videos = []

  mediaList.forEach(item => {
    if (item.type === 'photo') {
      images.push({
        url: forceOriginalQuality(item.media_url_https || item.media_url || ''),
        mediaType: 'image',
      })
      return
    }

    const variants = item.video_info?.variants || []
    const mp4s = variants.filter(v => v.content_type === 'video/mp4')
    if (mp4s.length === 0) return
    const best = mp4s.reduce((prev, current) =>
      (current.bitrate || 0) > (prev.bitrate || 0) ? current : prev
    )
    if (!best?.url) return
    videos.push({
      url: best.url,
      mediaType: 'video',
    })
  })

  return { images, videos }
}

function traverse(root, visitor) {
  const stack = [root]
  const visited = new Set()

  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (visited.has(node)) continue
    visited.add(node)
    visitor(node)

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        stack.push(node[i])
      }
        } else {
      Object.values(node).forEach(value => {
        if (typeof value === 'object') stack.push(value)
      })
    }
  }
}

let toastTimer = null
function notify(message) {
  let toast = document.querySelector('.videoman-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.className = 'videoman-toast'
    document.body.appendChild(toast)
  }

  toast.textContent = message
  toast.classList.add('is-visible')

  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-visible')
  }, 3000)
}

