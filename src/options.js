const form = document.getElementById('settingsForm')
const statusMessage = document.getElementById('statusMessage')

document.addEventListener('DOMContentLoaded', () => {
  fetchSettings()
  form.addEventListener('submit', handleSubmit)
  document.getElementById('useAria2').addEventListener('change', toggleAria2Fields)
})

function fetchSettings() {
  chrome.runtime.sendMessage({ type: 'get-settings' }, response => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError)
      return
    }
    if (!response?.ok) {
      console.error(response?.error || 'Ayarlar alınamadı')
      return
    }
    populateForm(response.settings)
  })
}

function populateForm(settings) {
  form.autoRevealSensitive.checked = !!settings.autoRevealSensitive
  form.useAria2.checked = !!settings.useAria2
  form.preferAria2ForVideos.checked = !!settings.preferAria2ForVideos
  form.aria2Url.value = settings.aria2Url || 'http://127.0.0.1:6800/jsonrpc'
  form.aria2Secret.value = settings.aria2Secret || ''
  toggleAria2Fields()
}

function toggleAria2Fields() {
  const disabled = !form.useAria2.checked
  form.preferAria2ForVideos.disabled = disabled
  form.aria2Url.disabled = disabled
  form.aria2Secret.disabled = disabled
}

function handleSubmit(event) {
  event.preventDefault()
  const settings = {
    autoRevealSensitive: form.autoRevealSensitive.checked,
    useAria2: form.useAria2.checked,
    preferAria2ForVideos: form.preferAria2ForVideos.checked,
    aria2Url: form.aria2Url.value.trim() || 'http://127.0.0.1:6800/jsonrpc',
    aria2Secret: form.aria2Secret.value.trim(),
  }

  chrome.runtime.sendMessage(
    {
      type: 'save-settings',
      payload: { settings },
    },
    response => {
      if (chrome.runtime.lastError) {
        showStatus('Kaydedilemedi', true)
        return
      }
      if (!response?.ok) {
        showStatus('Kaydedilemedi', true)
        return
      }
      showStatus('Ayarlar kaydedildi.')
    }
  )
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message
  statusMessage.className = isError ? 'error' : 'success'
  setTimeout(() => {
    statusMessage.textContent = ''
    statusMessage.className = ''
  }, 2500)
}

