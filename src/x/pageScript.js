(() => {
  if (window.__TWITTER_EX_INJECTED__) return
  window.__TWITTER_EX_INJECTED__ = true

  const TARGET_REGEX =
    /\/graphql\/[^/]+\/(TweetDetail|TweetResultByRestId|UserTweets|UserMedia|HomeTimeline|HomeLatestTimeline|UserTweetsAndReplies|UserHighlightsTweets|UserArticlesTweets|Bookmarks|Likes|CommunitiesExploreTimeline|ListLatestTweetsTimeline|SearchTimeline)$/
  const MESSAGE_TYPE = 'videoman:graphql'

  const originalFetch = window.fetch
  window.fetch = async (...args) => {
    try {
      const response = await originalFetch.apply(window, args)
      processResponse(response.clone(), args[0])
      return response
    } catch (err) {
      console.error('[videoman] fetch override error', err)
      throw err
    }
  }

  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (...args) {
    try {
      const [method, url] = args
      if (isTarget(url)) {
        this.addEventListener('load', () => processXhr(this, url))
      }
    } catch (err) {
      console.error('[videoman] xhr override error', err)
    }
    return originalOpen.apply(this, args)
  }

  function toUrl(requestInfo) {
    if (!requestInfo) return null
    if (typeof requestInfo === 'string') {
      return new URL(requestInfo, location.origin)
    }
    if (requestInfo instanceof URL) return requestInfo
    if (requestInfo instanceof Request) return new URL(requestInfo.url, location.origin)
    return null
  }

  function isTarget(requestInfo) {
    try {
      const url = toUrl(requestInfo)
      if (!url) return false
      return TARGET_REGEX.test(url.pathname)
    } catch {
      return false
    }
  }

  async function processResponse(response, requestInfo) {
    if (!isTarget(requestInfo)) return
    try {
      const text = await response.text()
      postPayload(requestInfo, response.status, text)
    } catch {
      // ignore clone errors
    }
  }

  function processXhr(xhr, requestInfo) {
    if (xhr.status !== 200) return
    postPayload(requestInfo, xhr.status, xhr.responseText)
  }

  function getPath(info) {
    const url = toUrl(info)
    if (url) return url.pathname
    if (info && typeof info === 'object' && 'responseURL' in info) {
      try {
        return new URL(info.responseURL).pathname
      } catch {
        return ''
      }
    }
    return ''
  }

  function postPayload(requestInfo, status, body) {
    try {
      window.postMessage(
        {
          source: 'videoman:injector',
          type: MESSAGE_TYPE,
          detail: {
            path: getPath(requestInfo),
            status,
            body,
          },
        },
        '*'
      )
    } catch (error) {
      console.error('[videoman] post message failed', error)
    }
  }
})()

