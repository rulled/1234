// ===== КОНФИГУРАЦИЯ =====
const CONFIG = {
  MAX_HISTORY_ITEMS: 100,  // Лимит записей в истории
  MAX_STORAGE_SIZE: 5 * 1024 * 1024,  // 5MB лимит для chrome.storage.local
  DOWNLOAD_TIMEOUT: 30000,  // 30 секунд таймаут
  RATE_LIMIT_MS: 500,  // Минимальный интервал между скачиваниями
  AUTO_CLEANUP_DAYS: 30,  // Автоочистка истории старше 30 дней
};

// ===== СОСТОЯНИЕ =====
let extensionEnabled = false;
let lastDownloadTime = 0;
let downloadQueue = [];
let isProcessingQueue = false;

// ===== ИНИЦИАЛИЗАЦИЯ =====
chrome.runtime.onInstalled.addListener(async () => {
  console.log('TTS Click Interceptor установлен/обновлён');
  
  // Инициализация состояния
  const data = await chrome.storage.local.get('extensionEnabled');
  extensionEnabled = data.extensionEnabled !== false;
  
  // Автоматическая очистка старых данных
  await cleanupOldHistory();
  
  // Создаём контекстное меню
  chrome.contextMenus.create({
    id: 'tts-toggle',
    title: 'TTS Interceptor: ' + (extensionEnabled ? 'Включено ✓' : 'Выключено ✗'),
    contexts: ['action']
  });
});

// ===== АВТОМАТИЧЕСКАЯ ОЧИСТКА =====
async function cleanupOldHistory() {
  try {
    const data = await chrome.storage.local.get('downloadHistory');
    const history = data.downloadHistory || [];
    
    const cutoffDate = Date.now() - (CONFIG.AUTO_CLEANUP_DAYS * 24 * 60 * 60 * 1000);
    const cleanedHistory = history.filter(item => item.timestamp > cutoffDate);
    
    if (cleanedHistory.length < history.length) {
      await chrome.storage.local.set({ downloadHistory: cleanedHistory });
      console.log(`Очищено ${history.length - cleanedHistory.length} старых записей истории`);
    }
    
    // Проверка размера storage
    const bytesInUse = await chrome.storage.local.getBytesInUse();
    if (bytesInUse > CONFIG.MAX_STORAGE_SIZE * 0.9) {
      // Если используется >90% лимита, удаляем старые записи
      const reducedHistory = cleanedHistory.slice(-50);
      await chrome.storage.local.set({ downloadHistory: reducedHistory });
      console.warn('Storage почти заполнен, история сокращена до 50 записей');
    }
  } catch (error) {
    console.error('Ошибка при очистке истории:', error);
  }
}

// ===== ЗАГРУЗКА СОСТОЯНИЯ =====
chrome.storage.local.get('extensionEnabled', (data) => {
  extensionEnabled = data.extensionEnabled !== false;
});

// ===== СЛУШАТЕЛЬ ИЗМЕНЕНИЙ =====
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled) {
    extensionEnabled = changes.extensionEnabled.newValue;
    // Обновляем контекстное меню
    chrome.contextMenus.update('tts-toggle', {
      title: 'TTS Interceptor: ' + (extensionEnabled ? 'Включено ✓' : 'Выключено ✗')
    });
  }
});

// ===== КОНТЕКСТНОЕ МЕНЮ =====
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'tts-toggle') {
    extensionEnabled = !extensionEnabled;
    await chrome.storage.local.set({ extensionEnabled });
  }
});

// ===== ВАЛИДАЦИЯ URL =====
function isValidAudioUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Проверка протокола
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }
    
    // Проверка расширения файла
    if (!urlObj.pathname.endsWith('.mp3')) {
      return false;
    }
    
    // Проверка домена (расширенная)
    const validDomains = [
      'cdn.hailuoai.video',
      'hailuoai.com',
      'minimax.io'
    ];
    
    if (!validDomains.some(domain => urlObj.hostname.includes(domain))) {
      console.warn('URL не из разрешённого домена:', urlObj.hostname);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Невалидный URL:', error);
    return false;
  }
}

// ===== САНИТИЗАЦИЯ ИМЕНИ ФАЙЛА =====
function sanitizeFilename(filename) {
  // Удаляем опасные символы и path traversal попытки
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 100); // Ограничиваем длину
}

// ===== СЧЁТЧИК ФАЙЛОВ =====
async function getNextFileNumber(voiceName) {
  try {
    const data = await chrome.storage.local.get('fileCounters');
    const counters = data.fileCounters || {};
    const currentCount = counters[voiceName] || 0;
    const nextCount = currentCount + 1;
    
    counters[voiceName] = nextCount;
    await chrome.storage.local.set({ fileCounters: counters });
    
    return nextCount;
  } catch (error) {
    console.error('Ошибка работы со счётчиком:', error);
    // Возвращаем timestamp как fallback
    return Date.now() % 10000;
  }
}

// ===== ИСТОРИЯ СКАЧИВАНИЙ =====
async function saveToDownloadHistory(voiceName, filename, fileNumber) {
  try {
    const data = await chrome.storage.local.get('downloadHistory');
    let history = data.downloadHistory || [];
    
    // Добавляем новую запись
    const newEntry = {
      voiceName,
      filename,
      fileNumber,
      timestamp: Date.now()
    };
    
    history.push(newEntry);
    
    // Ограничиваем размер истории
    if (history.length > CONFIG.MAX_HISTORY_ITEMS) {
      history = history.slice(-CONFIG.MAX_HISTORY_ITEMS);
    }
    
    await chrome.storage.local.set({ downloadHistory: history });
    
    // Отправляем уведомление об успешном скачивании
    await sendNotification('success', filename);
  } catch (error) {
    console.error('Ошибка сохранения истории:', error);
  }
}

// ===== УВЕДОМЛЕНИЯ =====
async function sendNotification(type, filename) {
  try {
    // Проверяем разрешения
    const hasPermission = await chrome.permissions.contains({
      permissions: ['notifications']
    });
    
    if (!hasPermission) return;
    
    const options = {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'TTS Click Interceptor',
      message: '',
      priority: 1
    };
    
    switch(type) {
      case 'success':
        options.message = `✓ Скачан: ${filename}`;
        break;
      case 'error':
        options.message = `✗ Ошибка скачивания: ${filename}`;
        break;
      case 'queue':
        options.message = `⏳ В очереди: ${downloadQueue.length} файлов`;
        break;
    }
    
    chrome.notifications.create('tts-' + Date.now(), options);
  } catch (error) {
    console.error('Ошибка отправки уведомления:', error);
  }
}

// ===== ОБРАБОТКА ОЧЕРЕДИ =====
async function processDownloadQueue() {
  if (isProcessingQueue || downloadQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (downloadQueue.length > 0) {
    const task = downloadQueue.shift();
    
    try {
      await performDownload(task);
      // Задержка между скачиваниями
      await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_MS));
    } catch (error) {
      console.error('Ошибка обработки задачи:', error);
      await sendNotification('error', task.filename || 'unknown');
    }
  }
  
  isProcessingQueue = false;
}

// ===== ВЫПОЛНЕНИЕ СКАЧИВАНИЯ =====
async function performDownload(task) {
  const { url, filename, sendResponse } = task;
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Download timeout'));
    }, CONFIG.DOWNLOAD_TIMEOUT);
    
    chrome.downloads.download({
      url: url,
      filename: filename,
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      clearTimeout(timeoutId);
      
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        // Отслеживаем статус скачивания
        chrome.downloads.onChanged.addListener(function listener(delta) {
          if (delta.id === downloadId) {
            if (delta.state && delta.state.current === 'complete') {
              chrome.downloads.onChanged.removeListener(listener);
              resolve(downloadId);
            } else if (delta.error) {
              chrome.downloads.onChanged.removeListener(listener);
              reject(new Error(delta.error.current));
            }
          }
        });
        
        resolve(downloadId);
      }
    });
  });
}

// ===== ОБРАБОТЧИК СООБЩЕНИЙ =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === "downloadFile") {
        // Проверка rate limiting
        const now = Date.now();
        if (now - lastDownloadTime < CONFIG.RATE_LIMIT_MS) {
          // Добавляем в очередь
          const tabId = sender.tab?.id ? String(sender.tab.id) : 'fallback-tab';
          const data = await chrome.storage.local.get('tabVoices');
          const voiceName = sanitizeFilename(data.tabVoices?.[tabId] || 'dictor');
          const fileNumber = await getNextFileNumber(voiceName);
          const paddedNumber = String(fileNumber).padStart(4, '0');
          const filename = `${voiceName}/${paddedNumber}_${voiceName}.mp3`;
          
          downloadQueue.push({
            url: request.url,
            filename,
            sendResponse
          });
          
          await sendNotification('queue', filename);
          processDownloadQueue();
          
          sendResponse({ success: true, queued: true });
          return;
        }
        
        lastDownloadTime = now;
        
        // Проверка состояния
        if (!extensionEnabled) {
          sendResponse({ success: false, reason: 'disabled' });
          return;
        }
        
        // Валидация URL
        if (!isValidAudioUrl(request.url)) {
          sendResponse({ success: false, reason: 'invalid-url' });
          return;
        }
        
        // Получаем настройки
        const tabId = sender.tab?.id ? String(sender.tab.id) : 'fallback-tab';
        const data = await chrome.storage.local.get('tabVoices');
        const voiceName = sanitizeFilename(data.tabVoices?.[tabId] || 'dictor');
        
        // Генерируем имя файла
        const fileNumber = await getNextFileNumber(voiceName);
        const paddedNumber = String(fileNumber).padStart(4, '0');
        const newFilename = `${voiceName}/${paddedNumber}_${voiceName}.mp3`;
        
        // Выполняем скачивание
        const downloadId = await performDownload({
          url: request.url,
          filename: newFilename
        });
        
        // Сохраняем в историю
        await saveToDownloadHistory(voiceName, newFilename, fileNumber);
        
        sendResponse({ success: true, downloadId });
        
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
        
      } else if (request.action === "getStats") {
        // Новый endpoint для статистики
        const data = await chrome.storage.local.get(['downloadHistory', 'fileCounters']);
        const history = data.downloadHistory || [];
        const counters = data.fileCounters || {};
        
        const stats = {
          totalDownloads: history.length,
          todayDownloads: history.filter(item => 
            item.timestamp > Date.now() - 24*60*60*1000
          ).length,
          totalVoices: Object.keys(counters).length,
          storageUsed: await chrome.storage.local.getBytesInUse()
        };
        
        sendResponse({ success: true, stats });
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

// ===== ПЕРИОДИЧЕСКАЯ ОЧИСТКА (раз в час) =====
setInterval(cleanupOldHistory, 60 * 60 * 1000);

console.log('TTS Click Interceptor: background script загружен');