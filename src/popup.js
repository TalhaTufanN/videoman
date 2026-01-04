document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage()
  })

  document.getElementById('clearHistory').addEventListener('click', clearHistory)
  loadHistory()
})

function loadHistory() {
  chrome.runtime.sendMessage({ type: 'get-history' }, response => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError)
      return
    }

    if (!response?.ok) {
      console.error(response?.error || 'Geçmiş alınamadı')
      return
    }

    renderHistory(response.history || [])
  })
}

function renderHistory(history) {
  const list = document.getElementById('historyList')
  const emptyState = document.getElementById('emptyState')
  list.innerHTML = ''

  if (!history.length) {
    emptyState.hidden = false
    return
  }

  emptyState.hidden = true

  history.forEach(entry => {
    const item = document.createElement('li')
    item.className = 'history-item'
    const date = new Date(entry.createdAt || Date.now())
    
    // Determine source/platform name
    const sourceName = entry.source === 'instagram' ? 'Instagram' : 
                      entry.source === 'twitter' ? 'Twitter/X' : 
                      'Bilinmeyen'

    item.innerHTML = `
      <div>
        <p class="history-filename">${entry.filename}</p>
        <p class="history-meta">
          ${sourceName} •
          ${entry.method === 'aria2' ? 'Aria2' : 'Tarayıcı'} •
          ${date.toLocaleString()} •
          <a href="${entry.url}" target="_blank" rel="noreferrer">Bağlantıyı aç</a>
        </p>
      </div>
    `

    list.appendChild(item)
  })
}

function clearHistory() {
  chrome.runtime.sendMessage({ type: 'clear-history' }, response => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError)
      return
    }

    if (!response?.ok) {
      console.error(response?.error || 'Geçmiş temizlenemedi')
      return
    }

    renderHistory([])
  })
}

