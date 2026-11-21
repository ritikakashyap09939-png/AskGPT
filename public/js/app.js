// app.js — main application logic

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var chats = [];
  var activeId = null;
  var activeChat = null;
  var sending = false;
  var abortController = null;
  var pendingImage = null;

  var ERROR_MESSAGES = {
    RATE_LIMIT: {
      hi: 'Bahut zyada requests ho gayi hain. Thodi der baad try karo.',
      en: 'Too many requests. Please wait a moment and try again.',
      'hi-en': 'Bahut zyada requests ho gayi hain. Thodi der baad try karo.'
    },
    MISSING_API_KEY: {
      hi: 'API key set nahi hai, .env file check karo.',
      en: 'API key is not set. Please check the .env file.',
      'hi-en': 'API key set nahi hai, .env file check karo.'
    },
    INVALID_INPUT: {
      hi: 'Message galat hai. Dobara likho.',
      en: 'Invalid message. Please try again.',
      'hi-en': 'Message galat hai. Dobara likho.'
    },
    SERVER_ERROR: {
      hi: 'Server mein kuch galat ho gaya. Thodi der baad try karo.',
      en: 'Something went wrong on the server. Please try again later.',
      'hi-en': 'Server mein kuch galat ho gaya. Thodi der baad try karo.'
    }
  };

  var HINGLISH_WORDS = [
    'kya', 'kaise', 'kaisa', 'kaisi', 'hai', 'hain', 'nahi', 'nahin', 'kar', 'karo',
    'karne', 'kro', 'batao', 'bata', 'mujhe', 'aap', 'tum', 'yaar', 'acha', 'accha',
    'haan', 'kaun', 'kyun', 'kyu', 'kab', 'kahan', 'chahiye', 'hua', 'ho', 'raha',
    'rahe', 'rahi', 'tha', 'thi', 'yeh', 'woh', 'wala', 'wali', 'matlab', 'samjha',
    'samjhao', 'bhejo', 'likho', 'likh', 'sunao', 'suno', 'thik', 'bahut', 'jyada',
    'kam', 'krna', 'karlo', 'bhej', 'do', 'hindi', 'mein', 'par', 'aur', 'lekin'
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function detectMessageLang(text) {
    var value = String(text == null ? '' : text);
    if (/[\u0900-\u097F]/.test(value)) return 'hi';

    var words = value.toLowerCase().split(/[^a-z]+/);
    for (var i = 0; i < words.length; i += 1) {
      if (HINGLISH_WORDS.indexOf(words[i]) !== -1) return 'hi-en';
    }
    return 'en';
  }

  function errorMessage(code, lastUserText) {
    var table = ERROR_MESSAGES[code];
    if (!table) {
      table = ERROR_MESSAGES.SERVER_ERROR;
      code = 'SERVER_ERROR';
    }
    var lang = detectMessageLang(lastUserText);
    return table[lang] || table.en || 'Something went wrong. Please try again.';
  }

  // ---------------------- Sidebar / chats ----------------------

  function renderSidebar() {
    UI.renderChatList(chats, activeId, {
      onSelect: selectChat,
      onDelete: function (id) {
        ChatStorage.deleteChat(id);
        chats = chats.filter(function (chat) { return chat.id !== id; });

        if (id === activeId) {
          if (chats.length) {
            selectChat(chats[0].id);
          } else {
            startNewChat();
          }
        } else {
          renderSidebar();
        }
      }
    });
    updateExportButton();
  }

  function updateExportButton() {
    var btn = $('export-btn');
    var menu = $('export-menu');
    var hasMessages = !!(activeChat && activeChat.messages && activeChat.messages.length > 0);

    if (btn) btn.hidden = !hasMessages;
    if (!hasMessages && menu) menu.hidden = true;
  }

  function findChat(id) {
    for (var i = 0; i < chats.length; i += 1) {
      if (chats[i].id === id) return chats[i];
    }
    return null;
  }

  function selectChat(id) {
    var chat = findChat(id);
    if (!chat) return;

    activeId = id;
    activeChat = chat;

    UI.renderMessages(chat.messages || []);
    addRegenerateButton();
    UI.closeSidebar();
    renderSidebar();
  }

  function startNewChat() {
    activeId = null;
    activeChat = null;

    var input = $('user-input');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      input.style.overflowY = 'hidden';
    }
    clearAttachment();
    updateSendState();

    UI.renderMessages([]);
    UI.showWelcome(true);
    UI.closeSidebar();
    renderSidebar();
  }

  // ---------------------- Composer state ----------------------

  function updateSendState() {
    var input = $('user-input');
    var sendBtn = $('send-btn');
    if (!sendBtn) return;

    if (sendBtn.classList.contains('stop')) {
      sendBtn.disabled = false;
      return;
    }

    sendBtn.disabled = !((input && input.value.trim()) || pendingImage);
  }

  function setStopMode(active) {
    var sendBtn = $('send-btn');
    if (!sendBtn) return;

    if (active) {
      sendBtn.classList.add('stop');
      sendBtn.disabled = false;
      sendBtn.setAttribute('aria-label', 'Stop generating');
      sendBtn.innerHTML = '<span class="send-btn-icon" aria-hidden="true">\u25A0</span>';
    } else {
      sendBtn.classList.remove('stop');
      sendBtn.setAttribute('aria-label', 'Send message');
      sendBtn.innerHTML = '<span class="send-btn-icon" aria-hidden="true">\u27A4</span>';
    }
  }

  function stopGeneration() {
    if (abortController) {
      try {
        abortController.abort();
      } catch (err) {
        /* ignore */
      }
    }
  }

  // ---------------------- Streaming ----------------------

  async function readStream(response, onEvent) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var i = 0; i < lines.length; i += 1) {
        var trimmed = lines[i].trim();
        if (trimmed.indexOf('data:') !== 0) continue;

        var data = trimmed.slice(5).trim();
        if (!data) continue;

        var event;
        try {
          event = JSON.parse(data);
        } catch (err) {
          continue;
        }
        onEvent(event);
      }
    }

    var tail = buffer.trim();
    if (tail.indexOf('data:') === 0) {
      var tailData = tail.slice(5).trim();
      if (tailData) {
        try {
          onEvent(JSON.parse(tailData));
        } catch (err) {
          /* ignore incomplete trailing event */
        }
      }
    }
  }

  // ---------------------- Send ----------------------

  function removeRegenerateButtons() {
    var list = $('messages');
    if (!list) return;

    var btns = list.querySelectorAll('.regenerate-btn');
    for (var i = btns.length - 1; i >= 0; i -= 1) {
      if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]);
    }
  }

  function addRegenerateButton() {
    var list = $('messages');
    if (!list) return;

    removeRegenerateButtons();
    if (sending) return;

    var bots = list.querySelectorAll('.message.bot');
    if (!bots.length) return;

    var lastBot = bots[bots.length - 1];
    var content = lastBot.querySelector('.message-content');
    if (!content) return;

    var actions = content.querySelector('.msg-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'msg-actions';
      content.appendChild(actions);
    }

    var btn = document.createElement('button');
    btn.className = 'msg-action-btn regenerate-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Regenerate response');
    btn.textContent = '\u27F3';
    btn.addEventListener('click', function () {
      regenerateLast();
    });
    actions.appendChild(btn);
  }

  // ---------------------- Attachments ----------------------

  function notify(message) {
    var node = document.getElementById('app-toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'app-toast';
      node.className = 'app-toast';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    window.clearTimeout(notify._timer);
    notify._timer = window.setTimeout(function () {
      node.classList.remove('show');
    }, 2600);
  }

  function clearAttachment() {
    pendingImage = null;

    var preview = $('attachment-preview');
    var img = $('attachment-img');
    var fileInput = $('image-input');

    if (preview) preview.hidden = true;
    if (img) img.removeAttribute('src');
    if (fileInput) fileInput.value = '';

    updateSendState();
  }

  function handleImageFile(file) {
    if (!file) return;

    var allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      notify('Sirf JPG, PNG ya WEBP images allowed hain.');
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      notify('Image 4 MB se chhoti honi chahiye.');
      return;
    }

    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var max = 1024;
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;

        if (w > max || h > max) {
          if (w >= h) {
            h = Math.round((h * max) / w);
            w = max;
          } else {
            w = Math.round((w * max) / h);
            h = max;
          }
        }

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;

        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        var mime = file.type === 'image/png'
          ? 'image/png'
          : (file.type === 'image/webp' ? 'image/webp' : 'image/jpeg');

        var dataUrl = canvas.toDataURL(mime, 0.85);

        pendingImage = dataUrl;

        var preview = $('attachment-preview');
        var previewImg = $('attachment-img');
        if (previewImg) previewImg.src = dataUrl;
        if (preview) preview.hidden = false;

        updateSendState();
      };
      img.onerror = function () {
        notify('Image load nahi ho payi.');
      };
      img.src = ev.target.result;
    };
    reader.onerror = function () {
      notify('Image read nahi ho payi.');
    };
    reader.readAsDataURL(file);
  }

  // ---------------------- Send / regenerate ----------------------

  async function sendMessage(text, inputMode) {
    text = String(text == null ? '' : text).trim();

    var imageData = pendingImage;
    if ((!text && !imageData) || sending) return;

    var input = $('user-input');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      input.style.overflowY = 'hidden';
    }

    clearAttachment();

    if (!activeChat) {
      activeChat = ChatStorage.createChat(text ? text.slice(0, 30) : 'Image chat');
      activeId = activeChat.id;
    }

    var chatRef = activeChat;
    if (!chatRef.messages) chatRef.messages = [];

    chatRef.messages.push({ role: 'user', content: imageData ? '[image]' : text });
    if (chatRef.messages.length === 1) {
      chatRef.title = text ? text.slice(0, 30) : 'Image chat';
    }
    ChatStorage.updateChat(chatRef);
    renderSidebar();

    UI.addUserMessage(text, imageData);
    UI.scrollToBottom();

    var requestMessages = chatRef.messages.slice(-15).map(function (msg) {
      return { role: msg.role, content: msg.content };
    });

    if (imageData && requestMessages.length) {
      var last = requestMessages.length - 1;
      requestMessages[last] = {
        role: 'user',
        content: [
          { type: 'text', text: text },
          { type: 'image_url', image_url: { url: imageData } }
        ]
      };
    }

    await generateReply(chatRef, inputMode, requestMessages);
  }

  function regenerateLast() {
    if (sending || !activeChat) return;

    var chatRef = activeChat;
    var msgs = chatRef.messages || [];

    var lastAssistant = -1;
    for (var i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].role === 'assistant') {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant === -1) return;

    msgs.splice(lastAssistant, 1);
    ChatStorage.updateChat(chatRef);

    var list = $('messages');
    if (list) {
      var bots = list.querySelectorAll('.message.bot');
      if (bots.length) {
        var lastBot = bots[bots.length - 1];
        if (lastBot.parentNode) lastBot.parentNode.removeChild(lastBot);
      }
    }

    renderSidebar();
    generateReply(chatRef, 'text');
  }

  async function generateReply(chatRef, inputMode, requestMessages) {
    if (sending || !chatRef) return;

    sending = true;
    setStopMode(true);
    addRegenerateButton();

    var lastUserText = '';
    for (var i = chatRef.messages.length - 1; i >= 0; i -= 1) {
      if (chatRef.messages[i].role === 'user') {
        lastUserText = chatRef.messages[i].content;
        break;
      }
    }

    UI.showTyping();
    UI.scrollToBottom();

    if (!requestMessages) {
      requestMessages = chatRef.messages.slice(-15).map(function (msg) {
        return { role: msg.role, content: msg.content };
      });
    }

    var full = '';
    var bot = null;
    var added = false;

    function ensureBot() {
      if (!bot) {
        UI.removeTyping();
        bot = UI.addBotMessage();
      }
      return bot;
    }

    function finalize(replyText, speak) {
      UI.removeTyping();

      if (replyText) {
        chatRef.messages.push({ role: 'assistant', content: replyText });
        ChatStorage.updateChat(chatRef);
        if (bot) {
          UI.addActions(bot, function () { return replyText; });
        }
        added = true;
      }

      UI.scrollToBottom();

      if (speak && inputMode === 'voice' && replyText && window.Voice) {
        if (typeof window.Voice.isSpeaking === 'function' && window.Voice.isSpeaking()) {
          window.Voice.stop();
        }
        window.Voice.speak(replyText);
      }
    }

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortController = controller;

    try {
      var response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          messages: requestMessages,
          inputMode: inputMode,
          stream: true
        })
      });

      if (!response.ok) {
        var errorBody = {};
        try {
          errorBody = await response.json();
        } catch (err) {
          errorBody = {};
        }
        handleError(errorBody.error || 'SERVER_ERROR', lastUserText);
        return;
      }

      var contentType = response.headers.get('content-type') || '';

      if (contentType.indexOf('text/event-stream') !== -1 && response.body && response.body.getReader) {
        try {
          await readStream(response, function (event) {
            if (event.error) {
              var streamErr = new Error(event.error);
              streamErr.code = event.error;
              throw streamErr;
            }

            if (typeof event.chunk === 'string') {
              ensureBot();
              full += event.chunk;
              UI.renderMarkdown(bot.content, full);
              UI.scrollToBottom();
            }

            if (event.done) {
              if (typeof event.reply === 'string' && event.reply) {
                full = event.reply;
              }
            }
          });
        } catch (streamErr) {
          if (streamErr && (streamErr.name === 'AbortError' || streamErr.code === 'ABORT_ERR')) {
            throw streamErr;
          }

          console.warn('Streaming failed, retrying without streaming:', streamErr && streamErr.message);

          var fallbackResponse = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller ? controller.signal : undefined,
            body: JSON.stringify({
              messages: requestMessages,
              inputMode: inputMode,
              stream: false
            })
          });

          var fallbackBody = {};
          try {
            fallbackBody = await fallbackResponse.json();
          } catch (parseErr) {
            fallbackBody = {};
          }

          if (!fallbackResponse.ok || fallbackBody.error) {
            handleError((fallbackBody && fallbackBody.error) || 'SERVER_ERROR', lastUserText);
            return;
          }

          full = fallbackBody.reply || '';
          ensureBot();
          UI.renderMarkdown(bot.content, full);
        }
      } else {
        var data = await response.json();
        if (data.error) {
          handleError(data.error, lastUserText);
          return;
        }
        full = data.reply || '';
        ensureBot();
        UI.renderMarkdown(bot.content, full);
      }

      ensureBot();
      finalize(full, true);
    } catch (err) {
      var aborted = (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) ||
        (controller && controller.signal && controller.signal.aborted);

      if (aborted) {
        finalize(full, false);
      } else {
        var code = (err && err.code) || 'SERVER_ERROR';
        handleError(code, lastUserText);
      }
    } finally {
      sending = false;
      abortController = null;
      setStopMode(false);
      UI.removeTyping();
      updateSendState();

      if (added) {
        addRegenerateButton();
      } else {
        removeRegenerateButtons();
      }
    }
  }

  function handleError(code, lastUserText) {
    UI.removeTyping();

    var message = errorMessage(code, lastUserText);
    var bot = UI.addBotMessage();
    bot.content.textContent = message;
    UI.scrollToBottom();
  }

  // ---------------------- Export ----------------------

  function exportFilename(ext) {
    var base = (activeChat && activeChat.title ? activeChat.title : 'askgpt-chat')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return (base || 'askgpt-chat') + '.' + ext;
  }

  function exportChatTxt() {
    if (!activeChat || !activeChat.messages || !activeChat.messages.length) return;

    var date = new Date(activeChat.createdAt || Date.now()).toLocaleString();
    var lines = [activeChat.title || 'AskGPT Chat', 'Date: ' + date, ''];

    activeChat.messages.forEach(function (msg) {
      lines.push((msg.role === 'user' ? 'You: ' : 'AskGPT: ') + (msg.content || ''));
      lines.push('');
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = exportFilename('txt');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportChatPdf() {
    if (!activeChat || !activeChat.messages || !activeChat.messages.length) return;
    window.print();
  }

  // ---------------------- Wire up events ----------------------

  var themeToggle = $('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || ChatStorage.loadTheme();
      var next = current === 'dark' ? 'light' : 'dark';
      ChatStorage.saveTheme(next);
      UI.setTheme(next);
    });
  }

  var newChatBtn = $('new-chat-btn');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', function () {
      startNewChat();
    });
  }

  var menuBtn = $('menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      UI.openSidebar();
    });
  }

  var sidebarCloseBtn = $('sidebar-close-btn');
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', function () {
      UI.closeSidebar();
    });
  }

  var sidebarOverlay = $('sidebar-overlay');
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', function () {
      UI.closeSidebar();
    });
  }

  var suggestions = $('suggestions');
  if (suggestions) {
    suggestions.addEventListener('click', function (ev) {
      var card = ev.target.closest ? ev.target.closest('.suggestion-card') : null;
      if (!card) return;
      var text = card.getAttribute('data-suggestion') || '';
      if (text) sendMessage(text, 'text');
    });
  }

  var input = $('user-input');
  var sendBtn = $('send-btn');

  var exportBtn = $('export-btn');
  var exportMenu = $('export-menu');
  if (exportBtn && exportMenu) {
    exportBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      exportMenu.hidden = !exportMenu.hidden;
    });

    exportMenu.addEventListener('click', function (ev) {
      var item = ev.target.closest ? ev.target.closest('.export-menu-item') : null;
      if (!item) return;

      exportMenu.hidden = true;
      var kind = item.getAttribute('data-export');
      if (kind === 'pdf') {
        exportChatPdf();
      } else {
        exportChatTxt();
      }
    });

    document.addEventListener('click', function (ev) {
      if (exportMenu.hidden) return;
      if (exportMenu.contains(ev.target) || ev.target === exportBtn) return;
      exportMenu.hidden = true;
    });
  }

  var attachBtn = $('attach-btn');
  var imageInput = $('image-input');
  var attachmentRemove = $('attachment-remove');

  if (attachBtn && imageInput) {
    attachBtn.addEventListener('click', function () {
      imageInput.click();
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', function () {
      var file = imageInput.files && imageInput.files[0];
      if (file) handleImageFile(file);
    });
  }

  if (attachmentRemove) {
    attachmentRemove.addEventListener('click', function () {
      clearAttachment();
    });
  }

  if (input) {
    input.addEventListener('input', function () {
      UI.autoGrow(input);
      updateSendState();
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        if (!sendBtn || !sendBtn.disabled) {
          sendMessage(input.value, 'text');
        }
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', function () {
      if (sending) {
        stopGeneration();
        return;
      }
      if (!input) return;
      sendMessage(input.value, 'text');
    });
  }

  if (window.Voice && typeof window.Voice.init === 'function') {
    window.Voice.init({
      onTranscript: function (text) {
        sendMessage(text, 'voice');
      },
      onStateChange: function () {
        /* voice.js updates the mic button itself */
      }
    });
  }

  // ---------------------- Boot ----------------------

  chats = ChatStorage.loadChats();
  UI.setTheme(ChatStorage.loadTheme());

  if (chats.length) {
    selectChat(chats[0].id);
  } else {
    startNewChat();
  }

  updateSendState();
});