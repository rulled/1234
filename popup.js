document.addEventListener('DOMContentLoaded', async () => {
  // Элементы интерфейса
  const toggleSwitch = document.getElementById('toggleSwitch');
  const toggleLabel = document.getElementById('toggleLabel');
  const voiceSelector = document.getElementById('voiceSelector');
  const newCustomNameInput = document.getElementById('newCustomName');
  const addCustomNameButton = document.getElementById('addCustomNameButton');
  const removeCustomNameButton = document.getElementById('removeCustomNameButton');
  const counterValue = document.getElementById('counterValue');
  const editCounterBtn = document.getElementById('editCounterBtn');
  const counterEditForm = document.getElementById('counterEditForm');
  const newCounterValue = document.getElementById('newCounterValue');
  const applyCounterBtn = document.getElementById('applyCounterBtn');
  const resetButton = document.getElementById('resetButton');
  const status = document.getElementById('status');
  const historyList = document.getElementById('historyList');
  const openFolderButton = document.getElementById('openFolderButton');
  const clearHistoryButton = document.getElementById('clearHistoryButton');

  // Управление вкладками
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Убираем активный класс со всех вкладок
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      
      // Добавляем активный класс к выбранной вкладке
      tab.classList.add('active');
      document.getElementById(targetTab).classList.add('active');
      
      // Если переключились на историю, загружаем её
      if (targetTab === 'history') {
        loadDownloadHistory();
      }
    });
  });

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
  let extensionEnabled = data.extensionEnabled === true;

  // Загружаем сохраненные настройки голоса для вкладки
  if (tabVoices[tabId]) {
    if ([...voiceSelector.options].map(o => o.value).includes(tabVoices[tabId])) {
      voiceSelector.value = tabVoices[tabId];
    }
  }

  // Загружаем кастомные имена
  updateVoiceSelector(customNames);
  if (tabVoices[tabId] && customNames.includes(tabVoices[tabId])) {
    voiceSelector.value = tabVoices[tabId];
  }

  // Обновляем тумблер
  updateToggleSwitch(extensionEnabled);

  // Инициализируем счетчик
  updateCounterDisplay();

  // Обработчик тумблера
  toggleSwitch.addEventListener('change', async () => {
    extensionEnabled = toggleSwitch.checked;
    await chrome.storage.local.set({ extensionEnabled: extensionEnabled });
    updateToggleSwitch(extensionEnabled);
    chrome.runtime.sendMessage({ action: 'updateExtensionState', enabled: extensionEnabled });
  });

  function updateToggleSwitch(enabled) {
    toggleSwitch.checked = enabled;
    if (enabled) {
      toggleLabel.textContent = 'Расширение активно ✓';
      toggleLabel.style.color = 'var(--accent-green)';
    } else {
      toggleLabel.textContent = 'Расширение остановлено';
      toggleLabel.style.color = 'var(--text-secondary)';
    }
  }

  // Автосохранение при изменении голоса
  voiceSelector.addEventListener('change', async () => {
    const selectedVoice = voiceSelector.value;

    const voicesData = await chrome.storage.local.get('tabVoices');
    const tabVoices = voicesData.tabVoices || {};
    tabVoices[tabId] = selectedVoice;
    await chrome.storage.local.set({ tabVoices: tabVoices });

    showStatus(`✓ Имя установлено: ${selectedVoice}`, 'success');
    updateCounterDisplay();
  });

  // Добавление нового кастомного имени
  addCustomNameButton.addEventListener('click', async () => {
    const newName = newCustomNameInput.value.trim();

    if (newName.length > 50) {
      showStatus('❌ Имя слишком длинное (макс. 50 символов)', 'error');
      return;
    }

    if (newName.length < 1) {
      showStatus('❌ Имя не может быть пустым', 'error');
      return;
    }
    
    if (!/^[a-zA-Z0-9а-яА-Я_-]+$/u.test(newName) || /[\x00-\x1F<>:"/\\|?*]|^\.*$|\.{2,}/.test(newName)) {
      showStatus('❌ Используйте только буквы, цифры, _ и -', 'error');
      return;
    }
    
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 
                          'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 
                          'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    if (reservedNames.includes(newName.toUpperCase())) {
      showStatus('❌ Недопустимое имя (зарезервировано системой)', 'error');
      return;
    }

    if (!getAllVoiceNames().includes(newName)) {
      const currentCustomNames = (await chrome.storage.local.get('customNames')).customNames || [];
      currentCustomNames.push(newName);
      await chrome.storage.local.set({ customNames: currentCustomNames });
      updateVoiceSelector(currentCustomNames);
      voiceSelector.value = newName;
      voiceSelector.dispatchEvent(new Event('change'));
      newCustomNameInput.value = '';
      showStatus(`✓ Имя "${newName}" добавлено`, 'success');
    } else {
      showStatus(`❌ Имя "${newName}" уже существует`, 'error');
    }
  });

  // Удаление кастомного имени
  removeCustomNameButton.addEventListener('click', async () => {
    const nameToRemove = voiceSelector.value;

    if (nameToRemove === 'dictor' || nameToRemove === 'doctor') {
      showStatus('❌ Нельзя удалить стандартные имена', 'error');
      return;
    }

    const currentCustomNames = (await chrome.storage.local.get('customNames')).customNames || [];

    if (!currentCustomNames.includes(nameToRemove)) {
      showStatus(`❌ Имя "${nameToRemove}" не найдено в списке`, 'error');
      return;
    }

    const updatedNames = currentCustomNames.filter(name => name !== nameToRemove);
    await chrome.storage.local.set({ customNames: updatedNames });

    if (voiceSelector.value === nameToRemove) {
      voiceSelector.value = 'dictor';
      const voicesData = await chrome.storage.local.get('tabVoices');
      const tabVoices = voicesData.tabVoices || {};
      tabVoices[tabId] = 'dictor';
      await chrome.storage.local.set({ tabVoices: tabVoices });
      showStatus(`✓ Имя "${nameToRemove}" удалено, выбрано "dictor"`, 'success');
    } else {
      showStatus(`✓ Имя "${nameToRemove}" удалено`, 'success');
    }

    updateVoiceSelector(updatedNames);
    updateCounterDisplay();
  });

  // Enter для добавления имени
  newCustomNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addCustomNameButton.click();
    }
  });

  // Функции для работы со счетчиком
  async function updateCounterDisplay() {
    const selectedVoice = voiceSelector.value;
    const data = await chrome.storage.local.get('fileCounters');
    const counters = data.fileCounters || {};
    const currentCount = counters[selectedVoice] || 0;
    counterValue.textContent = currentCount + 1;
  }

  voiceSelector.addEventListener('change', updateCounterDisplay);

  editCounterBtn.addEventListener('click', () => {
    counterEditForm.classList.add('active');
    newCounterValue.focus();
  });

  applyCounterBtn.addEventListener('click', async () => {
    const newNumber = parseInt(newCounterValue.value);
    const selectedVoice = voiceSelector.value;

    if (isNaN(newNumber) || newNumber < 1) {
      showStatus('❌ Введите корректный номер (минимум 1)', 'error');
      return;
    }

    const data = await chrome.storage.local.get('fileCounters');
    const counters = data.fileCounters || {};
    counters[selectedVoice] = newNumber - 1;

    await chrome.storage.local.set({ fileCounters: counters });
    updateCounterDisplay();
    counterEditForm.classList.remove('active');
    newCounterValue.value = '';
    showStatus(`✓ Счетчик установлен на ${newNumber}`, 'success');
  });

  // Enter для применения счетчика
  newCounterValue.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      applyCounterBtn.click();
    }
  });

  // Сброс счетчика
  resetButton.addEventListener('click', async () => {
    const selectedVoice = voiceSelector.value;

    if (confirm(`Вы уверены, что хотите сбросить счетчик для "${selectedVoice}"?\n\nЭто действие нельзя отменить.`)) {
      const data = await chrome.storage.local.get('fileCounters');
      const counters = data.fileCounters || {};
      if (counters[selectedVoice]) {
        delete counters[selectedVoice];
        await chrome.storage.local.set({ fileCounters: counters });
        updateCounterDisplay();
        showStatus(`✓ Счетчик для "${selectedVoice}" сброшен`, 'success');
      } else {
        showStatus(`ℹ️ Счетчик для "${selectedVoice}" уже пуст`, 'info');
      }
    }
  });

  // История скачиваний
  async function loadDownloadHistory() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getHistory' });

      if (response && response.success) {
        const history = response.history;

        historyList.innerHTML = '';

        if (history.length === 0) {
          historyList.innerHTML = '<div class="history-empty">📭 История пуста</div>';
          return;
        }

        const recentHistory = history.slice(-30).reverse();

        recentHistory.forEach((item) => {
          const div = document.createElement('div');
          div.className = 'history-item';
          
          const timeDiv = document.createElement('div');
          timeDiv.className = 'history-time';
          const date = new Date(item.timestamp);
          timeDiv.textContent = `⏰ ${date.toLocaleString('ru-RU')}`;
          
          const filenameDiv = document.createElement('div');
          filenameDiv.className = 'history-filename';
          filenameDiv.textContent = `📁 ${item.filename}`;
          
          div.appendChild(timeDiv);
          div.appendChild(filenameDiv);
          historyList.appendChild(div);
        });
      } else {
        historyList.innerHTML = '<div class="history-empty" style="color: var(--accent-red);">❌ Ошибка загрузки</div>';
      }
    } catch (error) {
      console.error('Ошибка загрузки истории:', error);
      historyList.innerHTML = '<div class="history-empty" style="color: var(--accent-red);">❌ Ошибка загрузки</div>';
    }
  }

  openFolderButton.addEventListener('click', () => {
    chrome.downloads.showDefaultFolder();
    showStatus('✓ Папка загрузок открыта', 'success');
  });

  clearHistoryButton.addEventListener('click', async () => {
    if (confirm('Вы уверены, что хотите очистить историю скачиваний?\n\nЭто действие нельзя отменить.')) {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'clearHistory' });
        if (response && response.success) {
          loadDownloadHistory();
          showStatus('✓ История очищена', 'success');
        } else {
          showStatus('❌ Ошибка при очистке истории', 'error');
        }
      } catch (error) {
        console.error('Ошибка очистки истории:', error);
        showStatus('❌ Ошибка при очистке истории', 'error');
      }
    }
  });

  function updateVoiceSelector(names) {
    Array.from(voiceSelector.options).forEach(option => {
      if (!['dictor', 'doctor'].includes(option.value)) {
        option.remove();
      }
    });

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

  let statusTimeout;
  function showStatus(message, type) {
    clearTimeout(statusTimeout);
    status.textContent = message;
    status.className = `status-${type}`;
    statusTimeout = setTimeout(() => {
      status.textContent = '';
      status.className = '';
    }, 3000);
  }
});
