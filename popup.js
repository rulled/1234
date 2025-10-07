document.addEventListener('DOMContentLoaded', async () => {
  const voiceSelector = document.getElementById('voiceSelector');
  const newCustomNameInput = document.getElementById('newCustomName');
  const addCustomNameButton = document.getElementById('addCustomNameButton');
  const removeCustomNameButton = document.getElementById('removeCustomNameButton');
  const resetButton = document.getElementById('resetButton');
  const toggleButton = document.getElementById('toggleButton');
  const status = document.getElementById('status');
  const counterDisplay = document.getElementById('counterDisplay');
  const setCounterButton = document.getElementById('setCounterButton');
  const setCounterInput = document.getElementById('setCounterInput');
  const applyCounterButton = document.getElementById('applyCounterButton');
  const downloadHistory = document.getElementById('downloadHistory');
  const openFolderButton = document.getElementById('openFolderButton');
  const clearHistoryButton = document.getElementById('clearHistoryButton');

  // Получаем реальный ID текущей вкладки
  let tabId;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs[0]?.id ? String(tabs[0].id) : 'fallback-tab';
  } catch (error) {
    console.error('Не удалось получить ID вкладки:', error);
    tabId = 'fallback-tab';
  }

  // Загружаем настройки
  const data = await chrome.storage.local.get(['tabVoices', 'customNames', 'extensionEnabled']);
  const tabVoices = data.tabVoices || {};
  const customNames = data.customNames || [];
  // По умолчанию расширение выключено
  let extensionEnabled = data.extensionEnabled === true;

  // Загружаем сохраненные настройки голоса для вкладки
  if (tabVoices[tabId]) {
    // Убеждаемся, что сохраненное значение существует в списке
    if ([...voiceSelector.options].map(o => o.value).includes(tabVoices[tabId])) {
        voiceSelector.value = tabVoices[tabId];
    }
  }

  // Загружаем кастомные имена
  updateVoiceSelector(customNames);
  // Если для вкладки было сохранено кастомное имя, выбираем его
  if (tabVoices[tabId] && customNames.includes(tabVoices[tabId])) {
    voiceSelector.value = tabVoices[tabId];
  }


  // Обновляем статус расширения
  updateToggleButton(extensionEnabled);

  // Инициализируем функции счетчика и истории
  updateCounterDisplay();
  loadDownloadHistory();

  // Автосохранение при изменении голоса
  voiceSelector.addEventListener('change', async () => {
    const selectedVoice = voiceSelector.value;

    const voicesData = await chrome.storage.local.get('tabVoices');
    const tabVoices = voicesData.tabVoices || {};
    tabVoices[tabId] = selectedVoice;
    await chrome.storage.local.set({ tabVoices: tabVoices });

    showStatus(`✓ имя для вкладки: ${selectedVoice}`, 'success');
  });

  // Добавление нового кастомного имени
  addCustomNameButton.addEventListener('click', async () => {
    const newName = newCustomNameInput.value.trim();

    // Валидация длины имени
    if (newName.length > 50) {
      showStatus('❌ имя слишком длинное (макс. 50 символов)', 'error');
      return;
    }

    if (newName.length < 1) {
      showStatus('❌ имя не может быть пустым', 'error');
      return;
    }
    
    // Более строгая проверка: только латиница, кириллица, цифры, _, -, без path traversal
    if (!/^[a-zA-Z0-9а-яА-Я_-]+$/u.test(newName) || /[\x00-\x1F<>:"/\\|?*]|^\.*$|\.{2,}/.test(newName)) {
      showStatus('❌ используйте только буквы, цифры, _ и -, избегайте . и ..', 'error');
      return;
    }
    
    // Проверка на зарезервированные имена файловой системы
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 
                          'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 
                          'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    if (reservedNames.includes(newName.toUpperCase())) {
      showStatus('❌ недопустимое имя (зарезервировано системой)', 'error');
      return;
    }
    if (!getAllVoiceNames().includes(newName)) {
      const currentCustomNames = (await chrome.storage.local.get('customNames')).customNames || [];
      currentCustomNames.push(newName);
      await chrome.storage.local.set({ customNames: currentCustomNames });
      updateVoiceSelector(currentCustomNames);
      voiceSelector.value = newName; // Сразу выбираем новое имя
      voiceSelector.dispatchEvent(new Event('change')); // Триггерим сохранение
      newCustomNameInput.value = '';
      showStatus(`✓ имя "${newName}" добавлено`, 'success');
    } else if (getAllVoiceNames().includes(newName)) {
      showStatus(`❌ имя "${newName}" уже существует`, 'error');
    }
  });

  // Удаление кастомного имени (выбранного в селекторе)
  removeCustomNameButton.addEventListener('click', async () => {
    const nameToRemove = voiceSelector.value;

    // Проверяем, что это кастомное имя (не dictor/doctor)
    if (nameToRemove === 'dictor' || nameToRemove === 'doctor') {
      showStatus('❌ нельзя удалить стандартные имена', 'error');
      return;
    }

    const currentCustomNames = (await chrome.storage.local.get('customNames')).customNames || [];

    if (!currentCustomNames.includes(nameToRemove)) {
      showStatus(`❌ имя "${nameToRemove}" не найдено в списке`, 'error');
      return;
    }

    // Удаляем из списка
    const updatedNames = currentCustomNames.filter(name => name !== nameToRemove);
    await chrome.storage.local.set({ customNames: updatedNames });

    // Переключаем на dictor если удаляемое имя было выбрано
    if (voiceSelector.value === nameToRemove) {
      voiceSelector.value = 'dictor';
      const voicesData = await chrome.storage.local.get('tabVoices');
      const tabVoices = voicesData.tabVoices || {};
      tabVoices[tabId] = 'dictor';
      await chrome.storage.local.set({ tabVoices: tabVoices });
      showStatus(`✓ имя "${nameToRemove}" удалено, выбрано "dictor"`, 'success');
    } else {
      showStatus(`✓ имя "${nameToRemove}" удалено`, 'success');
    }

    updateVoiceSelector(updatedNames);
  });

  // Enter для добавления имени
  newCustomNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addCustomNameButton.click();
    }
  });

  // Сброс счетчика (с подтверждением)
  resetButton.addEventListener('click', async () => {
    const selectedVoice = voiceSelector.value;

    if (confirm(`Вы уверены, что хотите сбросить счетчик для "${selectedVoice}"?\n\nЭто действие нельзя отменить.`)) {
      const data = await chrome.storage.local.get('fileCounters');
      const counters = data.fileCounters || {};
      if (counters[selectedVoice]) {
        delete counters[selectedVoice];
        await chrome.storage.local.set({ fileCounters: counters });
        showStatus(`✓ счетчик для "${selectedVoice}" сброшен`, 'success');
      } else {
        showStatus(`ℹ️ счетчик для "${selectedVoice}" уже пуст`, 'info');
      }
    }
  });

  // Переключение состояния расширения
  toggleButton.addEventListener('click', async () => {
    extensionEnabled = !extensionEnabled;
    await chrome.storage.local.set({ extensionEnabled: extensionEnabled });
    updateToggleButton(extensionEnabled);
    chrome.runtime.sendMessage({ action: 'updateExtensionState', enabled: extensionEnabled });
  });

  function updateToggleButton(enabled) {
    if (enabled) {
      toggleButton.textContent = 'расширение активно';
      toggleButton.className = 'enabled';
    } else {
      toggleButton.textContent = 'расширение остановлено';
      toggleButton.className = 'disabled';
    }
  }

  function updateVoiceSelector(names) {
    // Очищаем только кастомные опции
    Array.from(voiceSelector.options).forEach(option => {
      if (!['dictor', 'doctor'].includes(option.value)) {
        option.remove();
      }
    });
     // Удаляем сепараторы, если они есть
    Array.from(voiceSelector.options).forEach(option => {
        if (option.disabled) option.remove();
    });

    if (names.length > 0) {
      names.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.text = name;
        voiceSelector.add(option);
      });
    }
  }

  function getAllVoiceNames() {
      return Array.from(voiceSelector.options).map(o => o.value);
  }

  // Функции для работы со счетчиком
  async function updateCounterDisplay() {
    const selectedVoice = voiceSelector.value;
    const data = await chrome.storage.local.get('fileCounters');
    const counters = data.fileCounters || {};
    const currentCount = counters[selectedVoice] || 0;
    counterDisplay.value = `следующий: ${currentCount + 1}`;
  }

  // Обновляем счетчик при изменении голоса
  voiceSelector.addEventListener('change', updateCounterDisplay);

  // Кнопка установить счетчик
  setCounterButton.addEventListener('click', () => {
    setCounterInput.style.display = 'block';
    applyCounterButton.style.display = 'inline-block';
    setCounterInput.focus();
  });

  // Применение нового номера счетчика
  applyCounterButton.addEventListener('click', async () => {
    const newNumber = parseInt(setCounterInput.value);
    const selectedVoice = voiceSelector.value;

    if (isNaN(newNumber) || newNumber < 1) {
      showStatus('❌ введите корректный номер (минимум 1)', 'error');
      return;
    }

    const data = await chrome.storage.local.get('fileCounters');
    const counters = data.fileCounters || {};
    counters[selectedVoice] = newNumber - 1; // -1 потому что счетчик показывает следующий номер

    await chrome.storage.local.set({ fileCounters: counters });
    updateCounterDisplay();
    setCounterInput.style.display = 'none';
    applyCounterButton.style.display = 'none';
    setCounterInput.value = '';
    showStatus(`✓ счетчик установлен на ${newNumber}`, 'success');
  });

  // Скрываем поле ввода при клике вне его
  document.addEventListener('click', (e) => {
    if (!setCounterInput.contains(e.target) && !setCounterButton.contains(e.target)) {
      setCounterInput.style.display = 'none';
      applyCounterButton.style.display = 'none';
      setCounterInput.value = '';
    }
  });

  // Функции для работы с историей скачиваний
  async function loadDownloadHistory() {
    try {
      // Используем background script для получения истории
      const response = await chrome.runtime.sendMessage({ action: 'getHistory' });

      if (response && response.success) {
        const history = response.history;

        // Очищаем список
        downloadHistory.innerHTML = '';

        if (history.length === 0) {
          downloadHistory.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 10px;">история пуста</div>';
          return;
        }

        // Показываем последние 10 скачиваний
        const recentHistory = history.slice(-10).reverse();

        recentHistory.forEach((item, index) => {
          const div = document.createElement('div');
          const date = new Date(item.timestamp).toLocaleString('ru-RU');
          div.textContent = `${date} - ${item.filename} (${item.voiceName})`;
          div.style.cssText = `
            padding: 4px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          `;
          div.title = `Файл: ${item.filename}\nГолос: ${item.voiceName}\nВремя: ${date}`;
          downloadHistory.appendChild(div);
        });
      } else {
        downloadHistory.innerHTML = '<div style="color: var(--accent-red); text-align: center; padding: 10px;">ошибка загрузки</div>';
      }
    } catch (error) {
      console.error('Ошибка загрузки истории:', error);
      downloadHistory.innerHTML = '<div style="color: var(--accent-red); text-align: center; padding: 10px;">ошибка загрузки</div>';
    }
  }

  // Кнопка открыть папку
  openFolderButton.addEventListener('click', async () => {
    try {
      // Получаем путь к папке Downloads
      const downloadsPath = await getDownloadsFolder();
      if (downloadsPath) {
        // В Chrome API нет прямого способа открыть папку, но можно показать уведомление
        showStatus(`📁 откройте папку: ${downloadsPath}`, 'info');

        // Альтернатива: попробовать открыть через chrome.downloads.show
        chrome.downloads.showDefaultFolder();
      } else {
        showStatus('❌ не удалось определить папку загрузок', 'error');
      }
    } catch (error) {
      console.error('Ошибка открытия папки:', error);
      showStatus('❌ ошибка при открытии папки', 'error');
    }
  });

  // Кнопка очистить историю
  clearHistoryButton.addEventListener('click', async () => {
    if (confirm('Вы уверены, что хотите очистить историю скачиваний?\n\nЭто действие нельзя отменить.')) {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'clearHistory' });
        if (response && response.success) {
          loadDownloadHistory(); // Перезагружаем историю
          showStatus('✓ история очищена', 'success');
        } else {
          showStatus('❌ ошибка при очистке истории', 'error');
        }
      } catch (error) {
        console.error('Ошибка очистки истории:', error);
        showStatus('❌ ошибка при очистке истории', 'error');
      }
    }
  });

  // Функция для получения пути к папке загрузок
  async function getDownloadsFolder() {
    try {
      // Пробуем получить информацию о последнем скачивании
      const downloads = await new Promise((resolve) => {
        chrome.downloads.search({}, resolve);
      });

      if (downloads.length > 0) {
        const lastDownload = downloads[downloads.length - 1];
        return lastDownload.filename.substring(0, lastDownload.filename.lastIndexOf('/'));
      }
      return null;
    } catch (error) {
      console.error('Ошибка получения пути:', error);
      return null;
    }
  }

  let statusTimeout;
  function showStatus(message, type) {
      clearTimeout(statusTimeout);
      status.textContent = message;
      status.className = `status-${type}`;
      statusTimeout = setTimeout(() => status.textContent = '', 2500);
  }
});
