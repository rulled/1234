// Состояние расширения
let extensionEnabled = false;

// Загружаем состояние при старте
chrome.storage.local.get('extensionEnabled', (data) => {
  extensionEnabled = data.extensionEnabled !== false;
});

// Слушаем изменения состояния
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled) {
    extensionEnabled = changes.extensionEnabled.newValue;
  }
});

// Валидация URL для MP3 файлов
function isValidAudioUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Проверяем что это MP3
    if (!urlObj.pathname.endsWith('.mp3')) {
      return false;
    }
    
    // Проверяем домен (основные сайты с TTS)
    const validDomains = [
      'cdn.hailuoai.video',
      'hailuoai.com',
      'minimax.io'
    ];
    
    if (!validDomains.some(domain => urlObj.hostname.includes(domain))) {
      console.log('URL не из разрешённого домена:', urlObj.hostname);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Ошибка валидации URL:', error);
    return false;
  }
}

// Санитизация имени файла для безопасности
function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')  // Убираем недопустимые символы
    .replace(/\.{2,}/g, '_')  // Защита от path traversal
    .replace(/^\.+/, '')      // Убираем точки в начале
    .replace(/\.+$/, '')      // Убираем точки в конце
    .slice(0, 100);          // Ограничиваем длину
}

// Получаем следующий номер для файла
async function getNextFileNumber(voiceName) {
  const data = await chrome.storage.local.get('fileCounters');
  const counters = data.fileCounters || {};
  const currentCount = counters[voiceName] || 0;
  const nextCount = currentCount + 1;
  
  counters[voiceName] = nextCount;
  await chrome.storage.local.set({ fileCounters: counters });
  
  return nextCount;
}

// Сохраняем в историю скачиваний
async function saveToDownloadHistory(voiceName, filename, fileNumber) {
  try {
    const data = await chrome.storage.local.get('downloadHistory');
    let history = data.downloadHistory || [];
    
    // Добавляем запись
    history.push({
      voiceName,
      filename,
      fileNumber,
      timestamp: Date.now()
    });
    
    // Ограничиваем историю последними 100 записями
    if (history.length > 100) {
      history = history.slice(-100);
    }
    
    await chrome.storage.local.set({ downloadHistory: history });
  } catch (error) {
    console.error('Ошибка сохранения истории:', error);
  }
}

// Обработчик сообщений от content script и popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === "downloadFile") {
        // Проверяем состояние расширения
        if (!extensionEnabled) {
          console.log('Расширение отключено');
          sendResponse({ success: false, reason: 'disabled' });
          return;
        }

        const url = request.url;
        
        // Валидируем URL
        if (!isValidAudioUrl(url)) {
          console.log('Невалидный URL:', url);
          sendResponse({ success: false, reason: 'invalid-url' });
          return;
        }

        // Получаем ID вкладки
        const tabId = sender.tab?.id ? String(sender.tab.id) : 'fallback-tab';

        // Получаем выбранное имя для этой вкладки
        const data = await chrome.storage.local.get('tabVoices');
        const tabVoices = data.tabVoices || {};
        let voiceName = tabVoices[tabId];

        // Если имя не выбрано, используем по умолчанию
        if (!voiceName) {
          voiceName = 'dictor';
          tabVoices[tabId] = voiceName;
          await chrome.storage.local.set({ tabVoices: tabVoices });
        }

        // Санитизируем имя
        voiceName = sanitizeFilename(voiceName);

        // Получаем номер файла
        const fileNumber = await getNextFileNumber(voiceName);
        const paddedNumber = String(fileNumber).padStart(4, '0');
        const newFilename = `${voiceName}/${paddedNumber}_${voiceName}.mp3`;

        console.log(`Скачиваем ${url} как ${newFilename}`);

        // Скачиваем файл
        chrome.downloads.download({
          url: url,
          filename: newFilename,
          conflictAction: 'uniquify',
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('Ошибка скачивания:', chrome.runtime.lastError);
            sendResponse({ success: false, reason: chrome.runtime.lastError.message });
          } else {
            console.log('Скачивание начато, ID:', downloadId);
            // Сохраняем в историю
            saveToDownloadHistory(voiceName, newFilename, fileNumber);
            sendResponse({ success: true, downloadId });
          }
        });

      } else if (request.action === "updateExtensionState") {
        extensionEnabled = request.enabled;
        console.log(`Расширение ${extensionEnabled ? 'активировано' : 'остановлено'}`);
        sendResponse({ success: true });

      } else if (request.action === "getHistory") {
        const data = await chrome.storage.local.get('downloadHistory');
        sendResponse({ 
          success: true, 
          history: data.downloadHistory || [] 
        });

      } else if (request.action === "clearHistory") {
        await chrome.storage.local.set({ downloadHistory: [] });
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error('Ошибка в обработчике сообщений:', error);
      sendResponse({ 
        success: false, 
        reason: error.message || 'unknown-error' 
      });
    }
  })();
  
  return true; // Важно для асинхронных ответов
});

console.log('TTS Click Interceptor: background script загружен');