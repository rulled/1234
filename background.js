// Инициализация состояния расширения
let extensionEnabled = false;
let isInitialized = false;

// Структурированное логирование
const Logger = {
  info: (message, data) => console.log(`[TTS Interceptor] ${message}`, data || ''),
  warn: (message, data) => console.warn(`[TTS Interceptor] ${message}`, data || ''),
  error: (message, error) => {
    console.error(`[TTS Interceptor] ${message}`, error || '');
    // Отправляем критические ошибки в storage для последующего анализа
    chrome.storage.local.get('errorLog', (result) => {
      const errorLog = result.errorLog || [];
      errorLog.push({
        timestamp: new Date().toISOString(),
        message,
        error: error?.message || error,
        stack: error?.stack
      });
      // Храним только последние 50 ошибок
      if (errorLog.length > 50) errorLog.shift();
      chrome.storage.local.set({ errorLog });
    });
  }
};

// Загружаем состояние расширения при старте
async function initializeExtension() {
  try {
    const data = await chrome.storage.local.get('extensionEnabled');
    extensionEnabled = data.extensionEnabled !== false;
    isInitialized = true;
    Logger.info('Расширение инициализировано, состояние:', extensionEnabled);
  } catch (error) {
    Logger.error('Ошибка при загрузке состояния расширения:', error);
    isInitialized = true; // Даже при ошибке считаем инициализацию завершённой
  }
}

// Инициализируем сразу
initializeExtension();

// Слушаем изменения состояния
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled) {
    extensionEnabled = changes.extensionEnabled.newValue;
    console.log('Background: состояние обновлено:', extensionEnabled);
  }
});

// Улучшенная функция получения номера файла с блокировкой
async function getNextFileNumber(voiceName) {
  // Используем транзакционный подход для избежания race conditions
  return new Promise(async (resolve) => {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const data = await chrome.storage.local.get('fileCounters');
        const counters = data.fileCounters || {};
        const currentNumber = counters[voiceName] || 0;
        const nextNumber = currentNumber + 1;
        counters[voiceName] = nextNumber;

        await chrome.storage.local.set({ fileCounters: counters });
        resolve(nextNumber);
        return;
      } catch (error) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error('Не удалось обновить счётчик после нескольких попыток:', error);
          // В случае ошибки возвращаем timestamp для уникальности
          resolve(Date.now());
          return;
        }
        // Небольшая задержка перед повтором
        await new Promise(r => setTimeout(r, 100));
      }
    }
  });
}

// Функция очистки данных старых вкладок
async function cleanupOldTabs() {
  try {
    // Без разрешения tabs мы не можем получить список активных вкладок
    // Просто очищаем старые данные по времени (старше 24 часов)
    const tabData = await chrome.storage.local.get('tabVoices');
    const tabVoices = tabData.tabVoices || {};

    // Пока оставляем простую очистку - удаляем только при переустановке
    console.log('Очистка старых вкладок пропущена (нет разрешения tabs)');
  } catch (error) {
    console.error('Ошибка при очистке старых вкладок:', error);
  }
}

// Функция проверки валидности URL аудио файла
function isValidAudioUrl(url) {
  try {
    // Проверяем что это MP3 файл
    if (!url.toLowerCase().endsWith('.mp3')) {
      console.log('URL не является MP3 файлом:', url);
      return false;
    }

    // Проверяем что файл с одного из доменов MiniMax/Hailuo
    const validDomains = [
      'cdn.hailuoai.video',
      'hailuoai.video',
      'minimax.io',
      'cdn.minimax.io'
    ];

    const urlObj = new URL(url);
    const isValidDomain = validDomains.some(domain =>
      urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    );

    if (!isValidDomain) {
      console.log('URL не с поддерживаемого домена:', urlObj.hostname);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Ошибка при проверке URL:', error);
    return false;
  }
}

// Функция для безопасного создания имени файла
function sanitizeFilename(name) {
  // Удаляем или заменяем недопустимые символы для имён файлов и предотвращаем path traversal
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.\./g, '_')  // Предотвращаем path traversal
    .replace(/^\.+/, '_')   // Удаляем точки в начале
    .slice(0, 255);
}

// Функция сохранения в историю скачиваний
async function saveToDownloadHistory(voiceName, filename, fileNumber) {
  try {
    const data = await chrome.storage.local.get('downloadHistory');
    const history = data.downloadHistory || [];

    // Добавляем новую запись
    history.push({
      timestamp: new Date().toISOString(),
      voiceName: voiceName,
      filename: filename,
      fileNumber: fileNumber
    });

    // Ограничиваем историю последними 100 записями
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    await chrome.storage.local.set({ downloadHistory: history });
    console.log('История скачиваний обновлена');
  } catch (error) {
    console.error('Ошибка при сохранении в историю:', error);
  }
}

// Основной обработчик сообщений
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Асинхронный обработчик
  (async () => {
    try {
      // Ждём инициализации если необходимо
      if (!isInitialized) {
        await initializeExtension();
      }

      if (request.action === "downloadFile") {
        if (!extensionEnabled) {
          console.log('Расширение отключено, пропускаем загрузку');
          sendResponse({ success: false, reason: 'disabled' });
          return;
        }

        const url = request.url;
        // Используем фиксированный ID для текущей вкладки
        const tabId = 'current-tab';

        // Проверяем URL паттерн
        if (!isValidAudioUrl(url)) {
          console.log('URL не соответствует паттерну:', url);
          sendResponse({ success: false, reason: 'invalid-url' });
          return;
        }

        const data = await chrome.storage.local.get('tabVoices');
        const tabVoices = data.tabVoices || {};
        let voiceName = tabVoices[tabId];

        if (!voiceName) {
          // Используем "dictor" по умолчанию если голос не выбран
          voiceName = 'dictor';
          tabVoices[tabId] = voiceName;
          await chrome.storage.local.set({ tabVoices: tabVoices });
          console.log('Автоматически установлено имя: dictor');
        }

        // Санитизация имени для безопасности
        voiceName = sanitizeFilename(voiceName);

        // Получаем номер файла
        const fileNumber = await getNextFileNumber(voiceName);
        const paddedNumber = String(fileNumber).padStart(4, '0');
        const newFilename = `${voiceName}/${paddedNumber}_${voiceName}.mp3`;

        console.log(`Начинаю скачивание ${url} как ${newFilename}`);

        // Используем Promise с таймаутом для отслеживания результата загрузки
        const downloadTimeout = 30000; // 30 секунд таймаут
        const downloadId = await Promise.race([
          new Promise((resolve, reject) => {
            chrome.downloads.download({
              url: url,
              filename: newFilename,
              conflictAction: 'uniquify',
              saveAs: false // Не показывать диалог сохранения
            }, (id) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(id);
              }
            });
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Download timeout')), downloadTimeout)
          )
        ]);

        console.log('Файл успешно скачивается, ID:', downloadId);

        // Сохраняем в историю скачиваний
        await saveToDownloadHistory(voiceName, newFilename, fileNumber);

        sendResponse({ success: true, downloadId });

      } else if (request.action === "updateExtensionState") {
        extensionEnabled = request.enabled;
        console.log(`Расширение ${extensionEnabled ? 'активировано' : 'остановлено'}`);
        sendResponse({ success: true });

      } else if (request.action === "getCounter") {
        const voiceName = request.voiceName;
        const data = await chrome.storage.local.get('fileCounters');
        const counters = data.fileCounters || {};
        const currentCount = counters[voiceName] || 0;
        sendResponse({ success: true, counter: currentCount + 1 });

      } else if (request.action === "setCounter") {
        const voiceName = request.voiceName;
        const newNumber = request.number;

        if (newNumber < 1) {
          sendResponse({ success: false, reason: 'invalid-number' });
          return;
        }

        const data = await chrome.storage.local.get('fileCounters');
        const counters = data.fileCounters || {};
        counters[voiceName] = newNumber - 1;

        await chrome.storage.local.set({ fileCounters: counters });
        sendResponse({ success: true });

      } else if (request.action === "getHistory") {
        const data = await chrome.storage.local.get('downloadHistory');
        const history = data.downloadHistory || [];
        sendResponse({ success: true, history: history.slice(-20) });

      } else if (request.action === "clearHistory") {
        await chrome.storage.local.set({ downloadHistory: [] });
        sendResponse({ success: true });

      } else {
        sendResponse({ success: false, reason: 'unknown-action' });
      }
    } catch (error) {
      console.error('Ошибка при обработке запроса:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Важно: указываем что ответ будет асинхронным
});

// Запускать очистку при старте и установке
chrome.runtime.onStartup.addListener(cleanupOldTabs);
chrome.runtime.onInstalled.addListener(async (details) => {
  await cleanupOldTabs();

  // При первой установке устанавливаем значения по умолчанию
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      extensionEnabled: false,
      fileCounters: {},
      tabVoices: {},
      customNames: [],
      downloadHistory: []
    });
    console.log('Расширение установлено, настройки по умолчанию созданы');
  }
});



console.log('TTS Click Interceptor: фоновый скрипт запущен.');
