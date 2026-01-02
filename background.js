chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

    (async () => {
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

          chrome.downloads.download({
            url: blobUrl,
            filename: `insta_video_${Date.now()}.mp4`,
            saveAs: true
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error('background: download with blob failed', chrome.runtime.lastError);
              // fallback: doğrudan URL ile dene
              chrome.downloads.download({ url, filename: `insta_video_${Date.now()}.mp4`, saveAs: true });
            } else {
              console.log('background: blob download succeeded', downloadId);
              // Blob URL'yi biraz sonra serbest bırak
              setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch(e){} }, 15000);
            }
          });
          return;
        } else {
          console.warn('background: fetch returned not-ok', resp && resp.status);
        }
      } catch (err) {
        console.warn('background: fetch error', err && err.message);
      }

      // Eğer fetch başarısız olduysa veya blob yöntemi işe yaramadı, doğrudan downloads API ile dene
      console.log('background: attempting direct download via chrome.downloads API');
      chrome.downloads.download({
        url,
        filename: `insta_video_${Date.now()}.mp4`,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('background: direct download failed', chrome.runtime.lastError);
          if (sender && sender.tab && typeof sender.tab.id === 'number') {
            chrome.tabs.sendMessage(sender.tab.id, { action: 'download_failed', message: chrome.runtime.lastError.message || 'İndirme hatası' });
          }
        } else {
          console.log('background: direct download started', downloadId);
        }
      });
    })();
  }
});