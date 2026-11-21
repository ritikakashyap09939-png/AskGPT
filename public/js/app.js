// app.js — main application logic

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var chats = [];
  var activeId = null;
  var activeChat = null;
  var sending = false;

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
    sendBtn.disabled = !input || !input.value.trim();
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

  async function sendMessage(text, inputMode) {
    text = String(text == null ? '' : text).trim();
    if (!text || sending) return;

    sending = true;

    var input = $('user-input');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      input.style.overflowY = 'hidden';
    }
    updateSendState();

    if (!activeChat) {
      activeChat = ChatStorage.createChat(text.slice(0, 30));
      activeId = activeChat.id;
    }

    if (!activeChat.messages) activeChat.messages = [];

    activeChat.messages.push({ role: 'user', content: text });
    if (activeChat.messages.length === 1) {
      activeChat.title = text.slice(0, 30);
    }
    ChatStorage.updateChat(activeChat);
    renderSidebar();

    UI.addUserMessage(text);
    UI.showTyping();
    UI.scrollToBottom();

    var requestMessages = activeChat.messages.slice(-15).map(function (msg) {
      return { role: msg.role, content: msg.content };
    });

    var lastUserText = text;
    var full = '';
    var bot = null;

    function ensureBot() {
      if (!bot) {
        UI.removeTyping();
        bot = UI.addBotMessage();
      }
      return bot;
    }

    try {
      var response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      UI.removeTyping();

      if (full) {
        activeChat.messages.push({ role: 'assistant', content: full });
        ChatStorage.updateChat(activeChat);
        UI.addActions(bot, function () { return full; });
      }

      UI.scrollToBottom();

      if (inputMode === 'voice' && full && window.Voice) {
        if (typeof Voice.isSpeaking === 'function' && Voice.isSpeaking()) {
          Voice.stop();
        }
        Voice.speak(full);
      }
    } catch (err) {
      var code = (err && err.code) || 'SERVER_ERROR';
      handleError(code, lastUserText);
    } finally {
      sending = false;
      updateSendState();
    }
  }

  function handleError(code, lastUserText) {
    UI.removeTyping();

    var message = errorMessage(code, lastUserText);
    var bot = UI.addBotMessage();
    bot.content.textContent = message;
    UI.scrollToBottom();
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
      if (!input) return;
      sendMessage(input.value, 'text');
    });
  }

  if (window.Voice && typeof Voice.init === 'function') {
    Voice.init({
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