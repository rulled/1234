// Храним состояние расширения
let extensionEnabled = false;
let isInitialized = false;

// Функция инициализации
async function initialize() {
  try {
    const data = await chrome.storage.local.get('extensionEnabled');
    extensionEnabled = data.extensionEnabled !== false;
    isInitialized = true;
    console.log('Content script: состояние расширения загружено:', extensionEnabled);
  } catch (error) {
    console.error('Content script: ошибка загрузки состояния:', error);
    // При ошибке оставляем включённым по умолчанию
    extensionEnabled = true;
    isInitialized = true;
  }
}

// Инициализируем при загрузке
initialize();

// Слушаем изменения состояния
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled) {
    extensionEnabled = changes.extensionEnabled.newValue;
    console.log('Content script: состояние обновлено:', extensionEnabled);
  }
});

// Функция проверки валидности ссылки для скачивания
function isValidDownloadLink(url) {
  try {
    // Проверяем что URL указывает на mp3 файл
    if (!url.endsWith('.mp3')) {
      return false;
    }

    // Проверяем что URL начинается с ожидаемого домена и паттерна
    const expectedPattern = /^https:\/\/cdn\.hailuoai\.video\/moss\/prod\/\d{4}-\d{2}-\d{2}-\d{2}\/moss-audio\/user_audio\/[\w-]+-\d+\.mp3$/;

    return url.match(expectedPattern) !== null;
  } catch (error) {
    console.error('Ошибка при проверке ссылки:', error);
    return false;
  }
}

// Debounce для предотвращения множественных кликов
let lastClickTime = 0;
const CLICK_DEBOUNCE_MS = 300;

// Обработчик кликов
async function handleClick(event) {
  // Проверяем debounce
  const now = Date.now();
  if (now - lastClickTime < CLICK_DEBOUNCE_MS) {
    console.log('Клик проигнорирован (debounce)');
    return;
  }

  // Находим ближайший родительский тег <a>
  const link = event.target.closest('a');

  // Проверяем, что это ссылка
  if (!link || !link.href) {
    return;
  }

  console.log('Проверяем ссылку:', link.href);

  // Проверяем что это ссылка на mp3 файл с правильным доменом
  if (!isValidDownloadLink(link.href)) {
    return;
  }

  console.log('Перехвачен клик по MP3-ссылке:', link.href);

  // Ждём инициализации если необходимо
  if (!isInitialized) {
    await initialize();
  }

  // ВАЖНО: перехватываем ТОЛЬКО если расширение активно
  if (!extensionEnabled) {
    console.log('Расширение остановлено, пропускаем перехват');
    return;
  }

  // Обновляем время последнего клика
  lastClickTime = now;

  // Отменяем стандартное скачивание
  event.preventDefault();

  // Визуальная обратная связь (опционально)
  const originalText = link.textContent;
  const originalOpacity = link.style.opacity;
  link.style.opacity = '0.5';

  try {
    // Отправляем URL фоновому скрипту и ждём ответа
    const response = await chrome.runtime.sendMessage({
      action: "downloadFile",
      url: link.href
    });

    if (response && response.success) {
      console.log('Файл успешно отправлен на загрузку');
      // Можно добавить визуальную индикацию успеха
      link.style.opacity = originalOpacity;
    } else {
      console.error('Ошибка при загрузке:', response?.reason || 'unknown');
      // Восстанавливаем ссылку при ошибке
      link.style.opacity = originalOpacity;

      // При критической ошибке можно разрешить стандартную загрузку
      if (response?.reason === 'disabled' || response?.reason === 'invalid-url') {
        // Программно кликаем по ссылке для стандартной загрузки
        setTimeout(() => {
          const newEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          });
          // Временно отключаем обработчик
          document.removeEventListener('click', handleClick, true);
          link.dispatchEvent(newEvent);
          // Включаем обработчик обратно
          setTimeout(() => {
            document.addEventListener('click', handleClick, true);
          }, 100);
        }, 100);
      }
    }
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    link.style.opacity = originalOpacity;
  }
}

// Слушаем клики по всему документу
document.addEventListener('click', handleClick, true);

// Обработка динамически добавляемого контента с дебаунсом
let mutationDebounceTimer = null;
const MUTATION_DEBOUNCE_MS = 100;

const observer = new MutationObserver((mutations) => {
  // Используем дебаунс для оптимизации производительности
  clearTimeout(mutationDebounceTimer);
  mutationDebounceTimer = setTimeout(() => {
    // Проверяем, не добавились ли новые ссылки на странице
    let mp3LinksFound = 0;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.querySelectorAll) {
            const links = node.querySelectorAll('a[href$=".mp3"]');
            mp3LinksFound += links.length;
          }
        }
      }
    }
    if (mp3LinksFound > 0) {
      console.log(`Обнаружено ${mp3LinksFound} новых MP3 ссылок`);
    }
  }, MUTATION_DEBOUNCE_MS);
});

// Наблюдаем только за контейнером с контентом, если возможно
const contentContainer = document.querySelector('main') || document.querySelector('.content') || document.body;
observer.observe(contentContainer, {
  childList: true,
  subtree: true,
  // Исключаем наблюдение за атрибутами для оптимизации
  attributes: false,
  characterData: false
});

// Очистка при выгрузке страницы
window.addEventListener('beforeunload', () => {
  observer.disconnect();
});

console.log('TTS Click Interceptor: скрипт активирован и готов перехватывать клики.');
