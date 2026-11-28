// app.js — main application logic

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var chats = [];
  var activeId = null;
  var activeChat = null;
  var sending = false;
  var abortController = null;
  var pendingImage = null;
  var authEnabled = false;
  var token = null;
  var currentUser = null;
  var authMode = 'login';
  var providers = {};
  var pendingAuthError = null;
  var lastFailedUserMessage = null; // { text, imageData, inputMode, requestMessages }
  var imageMode = false; // whether to use image generation for next message
  var voiceChatActive = false; // whether voice conversation mode is active

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
    },
    IMAGE_UNAVAILABLE: {
      hi: 'Abhi image nahi ban sakti, thodi der baad try karo.',
      en: 'Image generation is unavailable right now. Please try again later.',
      'hi-en': 'Abhi image nahi ban sakti, thodi der baad try karo.'
    },
    IMAGE_BLOCKED: {
      hi: 'Ye request allow nahi hai. Kuch aur likho.',
      en: 'This request was blocked. Please try a different prompt.',
      'hi-en': 'Ye request allow nahi hai. Kuch aur likho.'
    },
    PROMPT_TOO_LONG: {
      hi: 'Prompt bahut lamba hai. Chhota likho.',
      en: 'Prompt is too long. Please shorten it.',
      'hi-en': 'Prompt bahut lamba hai. Chhota likho.'
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

  // Image generation keywords for auto-detection
  var IMAGE_KEYWORDS = [
    // English
    'generate image', 'create image', 'draw', 'create a picture', 'make an image',
    'generate a picture', 'create picture', 'make picture', 'draw a picture',
    'generate art', 'create art', 'make art', 'draw art', 'paint', 'illustrate',
    'image of', 'picture of', 'photo of', 'visualize', 'render',
    // Hindi/Hinglish
    'image banao', 'photo banao', 'tasveer banao', 'picture banao',
    'chitra banao', 'drawing banao', 'art banao', 'image banana',
    'photo banana', 'tasveer banana', 'picture banana',
    'image kaise banaye', 'photo kaise banaye', 'tasveer kaise banaye',
    'ek image banao', 'ek photo banao', 'ek tasveer banao',
  ];

  function isImagePrompt(text) {
    var value = String(text == null ? '' : text).toLowerCase().trim();
    for (var i = 0; i < IMAGE_KEYWORDS.length; i += 1) {
      if (value.indexOf(IMAGE_KEYWORDS[i]) !== -1) return true;
    }
    return false;
  }

  // ---------------------- Auth / storage ----------------------

  function authHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function setToken(value) {
    token = value || null;
    try {
      if (token) localStorage.setItem('askgpt_token', token);
      else localStorage.removeItem('askgpt_token');
    } catch (err) {
      /* ignore storage errors */
    }
  }

  async function apiListChats() {
    var res = await fetch('/api/chats', { headers: authHeaders() });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'SERVER_ERROR');
    return data.chats || [];
  }

  async function apiCreateChat(title) {
    var res = await fetch('/api/chats', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title: title, messages: [] })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'SERVER_ERROR');
    return data.chat;
  }

  async function apiSaveChat(chat) {
    var res = await fetch('/api/chats/' + encodeURIComponent(chat.id), {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ title: chat.title, messages: chat.messages })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'SERVER_ERROR');
    return data.chat;
  }

  async function apiDeleteChat(id) {
    var res = await fetch('/api/chats/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) {
      var data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || 'SERVER_ERROR');
    }
  }

  var Store = {
    list: async function () {
      if (authEnabled) return await apiListChats();
      return ChatStorage.loadChats();
    },
    create: async function (title) {
      if (authEnabled) return await apiCreateChat(title);
      return ChatStorage.createChat(title);
    },
    save: async function (chat) {
      if (authEnabled) return await apiSaveChat(chat);
      ChatStorage.updateChat(chat);
      return chat;
    },
    remove: async function (id) {
      if (authEnabled) return await apiDeleteChat(id);
      ChatStorage.deleteChat(id);
    }
  };

  function persistChat(chat) {
    return Store.save(chat).catch(function (err) {
      console.warn('Chat save failed:', err && err.message ? err.message : err);
    });
  }

  // ---------------------- Auth UI ----------------------

  function authErrorMessage(code) {
    var map = {
      INVALID_EMAIL: 'Email sahi nahi hai.',
      WEAK_PASSWORD: 'Password kam se kam 8 characters ka hona chahiye.',
      EMAIL_EXISTS: 'Ye email already registered hai.',
      INVALID_CREDENTIALS: 'Email ya password galat hai.',
      RATE_LIMIT: 'Bahut zyada requests. Thodi der baad try karo.',
      SERVER_ERROR: 'Server error. Dobara try karo.',
      UNAUTHORIZED: 'Login required hai.',
      OAUTH_ERROR: 'Google ya GitHub login fail ho gaya. Dobara try karo.'
    };
    return map[code] || 'Kuch galat ho gaya. Dobara try karo.';
  }

  function updateAuthModal() {
    var isLogin = authMode === 'login';
    var title = $('auth-title');
    if (title) title.textContent = isLogin ? 'Log in' : 'Sign up';
    var submit = $('auth-submit');
    if (submit) submit.textContent = isLogin ? 'Log in' : 'Sign up';
    var label = $('auth-switch-label');
    if (label) label.textContent = isLogin ? 'Naya account?' : 'Account hai?';
    var sw = $('auth-switch-btn');
    if (sw) sw.textContent = isLogin ? 'Sign up' : 'Log in';
    var err = $('auth-error');
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
  }

  function showAuthModal(mode) {
    authMode = mode === 'signup' ? 'signup' : 'login';
    var modal = $('auth-modal');
    if (modal) modal.hidden = false;
    updateAuthModal();
    var email = $('auth-email');
    if (email) email.focus();
  }

  function hideAuthModal() {
    var modal = $('auth-modal');
    if (modal) modal.hidden = true;
  }

  function updateOAuthButtons() {
    var block = $('oauth-block');
    var google = $('oauth-google');
    var github = $('oauth-github');
    var hasGoogle = !!providers.google;
    var hasGithub = !!providers.github;

    if (block) block.hidden = !(hasGoogle || hasGithub);
    if (google) google.hidden = !hasGoogle;
    if (github) github.hidden = !hasGithub;
  }

  function showAuthError(code) {
    var errEl = $('auth-error');
    if (errEl) {
      errEl.textContent = authErrorMessage(code);
      errEl.hidden = false;
    }
  }

  // Read the OAuth redirect hash (#token=... or #auth_error=1), save the token
  // exactly like a normal login, and strip the hash from the URL immediately.
  function consumeOAuthHash() {
    var hash = window.location.hash || '';
    if (hash.indexOf('token=') === -1 && hash.indexOf('auth_error') === -1) return;

    var raw = hash.replace(/^#/, '');
    var params = new URLSearchParams(raw);
    var tokenParam = params.get('token');
    var errorParam = params.get('auth_error');

    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (err) {
      /* ignore */
    }

    if (tokenParam) {
      setToken(tokenParam);
    } else if (errorParam) {
      pendingAuthError = 'OAUTH_ERROR';
    }
  }

  function updateUserBox() {
    var box = $('user-box');
    var emailEl = $('user-email');
    if (box) box.hidden = !currentUser;
    if (emailEl) emailEl.textContent = currentUser || '';
  }

  async function handleAuthSubmit(ev) {
    ev.preventDefault();

    var emailEl = $('auth-email');
    var passEl = $('auth-password');
    var errEl = $('auth-error');
    if (!emailEl || !passEl) return;

    var email = emailEl.value.trim();
    var password = passEl.value;

    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }

    try {
      var res = await fetch('/api/auth/' + (authMode === 'login' ? 'login' : 'signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      });
      var data = await res.json().catch(function () { return {}; });

      if (!res.ok || !data.token) {
        if (errEl) {
          errEl.textContent = authErrorMessage(data.error);
          errEl.hidden = false;
        }
        return;
      }

      setToken(data.token);
      currentUser = (data.user && data.user.email) || email;
      passEl.value = '';
      hideAuthModal();
      updateUserBox();
      await loadChatsFromServer();
    } catch (err) {
      if (errEl) {
        errEl.textContent = 'Network error. Dobara try karo.';
        errEl.hidden = false;
      }
    }
  }

  async function loadChatsFromServer() {
    try {
      chats = await Store.list();
      if (chats.length) {
        selectChat(chats[0].id);
      } else {
        startNewChat();
      }
    } catch (err) {
      logout();
    }
  }

  function logout() {
    setToken(null);
    currentUser = null;
    updateUserBox();
    chats = [];
    activeId = null;
    activeChat = null;
    startNewChat();
    if (authEnabled) showAuthModal('login');
  }

  // ---------------------- Sidebar / chats ----------------------

  function renderSidebar() {
    UI.renderChatList(chats, activeId, {
      onSelect: selectChat,
      onDelete: function (id) {
        Store.remove(id).catch(function () {}).then(function () {
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
        });
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
      try {
        activeChat = await Store.create(text ? text.slice(0, 30) : 'Image chat');
      } catch (err) {
        notify(authEnabled ? 'Chat save nahi hua. Dobara login karo.' : 'Chat save nahi hua.');
        if (authEnabled) showAuthModal('login');
        return;
      }
      activeId = activeChat.id;
    }

    var chatRef = activeChat;
    if (!chatRef.messages) chatRef.messages = [];

    chatRef.messages.push({ role: 'user', content: imageData ? '[image]' : text });
    if (chatRef.messages.length === 1) {
      chatRef.title = text ? text.slice(0, 30) : 'Image chat';
    }
    await persistChat(chatRef);
    renderSidebar();

    UI.addUserMessage(text, imageData);
    UI.scrollToBottom();

    // Determine if this should be an image generation request
    var useImageGen = imageMode || isImagePrompt(text);
    // Reset image mode after use (toggle is one-shot)
    if (imageMode) {
      imageMode = false;
      var imgBtn = $('image-btn');
      if (imgBtn) {
        imgBtn.setAttribute('aria-pressed', 'false');
        imgBtn.classList.remove('active');
      }
      var inputEl = $('user-input');
      if (inputEl) inputEl.placeholder = 'Kuch bhi poochho...';
    }

    if (useImageGen) {
      await generateImage(chatRef, text, inputMode);
      return;
    }

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

    lastFailedUserMessage = {
      text: text,
      imageData: imageData,
      inputMode: inputMode,
      requestMessages: requestMessages
    };

    await generateReply(chatRef, inputMode, requestMessages);
  }

  async function generateImage(chatRef, prompt, inputMode) {
    if (sending || !chatRef) return;

    sending = true;
    setStopMode(true);

    var lastUserText = prompt;

    UI.showTyping();
    UI.scrollToBottom();

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortController = controller;

    try {
      var response = await fetch('/api/image', {
        method: 'POST',
        headers: authHeaders(),
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({ prompt: prompt })
      });

      if (!response.ok) {
        if (response.status === 401) {
          logout();
          return;
        }
        var errorBody = {};
        try {
          errorBody = await response.json();
        } catch (err) {
          errorBody = {};
        }
        handleError(errorBody.error || 'SERVER_ERROR', lastUserText);
        return;
      }

      var data = await response.json();
      if (data.error) {
        handleError(data.error, lastUserText);
        return;
      }

      UI.removeTyping();

      // Add bot message with image
      var bot = UI.addBotMessage();
      if (data.image) {
        var img = document.createElement('img');
        img.className = 'msg-image';
        img.src = data.image;
        img.alt = 'Generated image';
        img.style.maxWidth = '100%';
        img.style.borderRadius = 'var(--radius-md)';
        img.style.cursor = 'zoom-in';
        bot.content.appendChild(img);

        // Click to zoom
        img.addEventListener('click', function () {
          openImageZoom(data.image);
        });

        // Download button
        var downloadBtn = document.createElement('button');
        downloadBtn.className = 'msg-action-btn';
        downloadBtn.type = 'button';
        downloadBtn.setAttribute('aria-label', 'Download image');
        downloadBtn.textContent = '⬇';
        downloadBtn.style.marginTop = '8px';
        downloadBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          downloadImage(data.image, 'askgpt-image.png');
        });
        bot.content.appendChild(document.createElement('br'));
        bot.content.appendChild(downloadBtn);
      }
      if (data.text) {
        var textEl = document.createElement('div');
        textEl.className = 'msg-text';
        textEl.textContent = data.text;
        bot.content.appendChild(textEl);
      }

      // Save only "[image]" in chat history, not base64
      chatRef.messages.push({ role: 'assistant', content: '[image]' });
      persistChat(chatRef);

      UI.scrollToBottom();
    } catch (err) {
      var aborted = (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) ||
        (controller && controller.signal && controller.signal.aborted);

      if (!aborted) {
        var code = (err && err.code) || 'SERVER_ERROR';
        handleError(code, lastUserText);
      }
    } finally {
      sending = false;
      abortController = null;
      setStopMode(false);
      UI.removeTyping();
      updateSendState();
    }
  }

  function openImageZoom(src) {
    var overlay = document.createElement('div');
    overlay.className = 'image-zoom-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '1000';
    overlay.style.background = 'rgba(0,0,0,0.9)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.cursor = 'zoom-out';

    var img = document.createElement('img');
    img.src = src;
    img.style.maxWidth = '90vw';
    img.style.maxHeight = '90vh';
    img.style.borderRadius = '8px';
    img.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';

    overlay.appendChild(img);
    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
    }
    overlay.addEventListener('click', close);
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
  }

  function downloadImage(dataUrl, filename) {
    var link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    persistChat(chatRef);

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
        persistChat(chatRef);
        if (bot) {
          UI.addActions(bot, function () { return replyText; });
        }
        added = true;
        lastFailedUserMessage = null;
      }

      UI.scrollToBottom();

      // Voice conversation mode: use the special callback that handles auto-restart of listening
      if (speak && inputMode === 'voice' && replyText && window.Voice && voiceChatActive) {
        if (typeof window.Voice.onVoiceChatBotReply === 'function') {
          window.Voice.onVoiceChatBotReply(replyText);
        }
      } else if (speak && inputMode === 'voice' && replyText && window.Voice) {
        // Regular voice input mode (single shot)
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
        headers: authHeaders(),
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          messages: requestMessages,
          inputMode: inputMode,
          stream: true
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          logout();
          return;
        }
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
            headers: authHeaders(),
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
            if (fallbackResponse.status === 401) {
              logout();
              return;
            }
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
        lastFailedUserMessage = null;
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

    if (code === 'SERVER_ERROR' && lastFailedUserMessage) {
      var retryBtn = document.createElement('button');
      retryBtn.className = 'msg-action-btn retry-btn';
      retryBtn.type = 'button';
      retryBtn.setAttribute('aria-label', 'Retry');
      retryBtn.textContent = 'Retry';
      retryBtn.style.marginTop = '8px';
      retryBtn.style.fontSize = '0.85em';
      retryBtn.addEventListener('click', function () {
        retryFailedMessage(bot);
      });
      bot.content.appendChild(document.createElement('br'));
      bot.content.appendChild(retryBtn);
    }
  }

  function retryFailedMessage(errorBot) {
    if (!lastFailedUserMessage || !activeChat) return;

    var chatRef = activeChat;
    var msgs = chatRef.messages || [];

    var lastUserIdx = -1;
    for (var i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx !== -1) {
      msgs.splice(lastUserIdx, 1);
    }

    var list = $('messages');
    if (list) {
      var users = list.querySelectorAll('.message.user');
      if (users.length) {
        var lastUser = users[users.length - 1];
        if (lastUser.parentNode) lastUser.parentNode.removeChild(lastUser);
      }
    }

    if (errorBot && errorBot.parentNode) {
      errorBot.parentNode.removeChild(errorBot);
    }

    lastFailedUserMessage = null;

    persistChat(chatRef);
    renderSidebar();

    sendMessage(lastFailedUserMessage.text, lastFailedUserMessage.inputMode);
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

  var imageBtn = $('image-btn');
  if (imageBtn) {
    imageBtn.addEventListener('click', function () {
      imageMode = !imageMode;
      imageBtn.setAttribute('aria-pressed', imageMode ? 'true' : 'false');
      imageBtn.classList.toggle('active', imageMode);
      var inputEl = $('user-input');
      if (inputEl) {
        inputEl.placeholder = imageMode ? 'Kaisi image chahiye? Likho...' : 'Kuch bhi poochho...';
      }
    });
  }

  var voiceChatBtn = $('voice-chat-btn');
  if (voiceChatBtn && window.Voice) {
    voiceChatBtn.addEventListener('click', function () {
      if (window.Voice.isVoiceChatActive()) {
        window.Voice.stopVoiceChat();
        voiceChatBtn.classList.remove('active');
        voiceChatBtn.setAttribute('aria-pressed', 'false');
        voiceChatActive = false;
      } else {
        if (sending) {
          stopGeneration();
        }
        voiceChatActive = true;
        voiceChatBtn.classList.add('active');
        voiceChatBtn.setAttribute('aria-pressed', 'true');
        window.Voice.startVoiceChat({
          onTranscript: function (text) {
            sendMessage(text, 'voice');
          },
          onError: function (err) {
            notify(err);
            voiceChatBtn.classList.remove('active');
            voiceChatBtn.setAttribute('aria-pressed', 'false');
            voiceChatActive = false;
          }
        });
      }
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
      },
      onVoiceChatTranscript: function (text) {
        // Called when user speaks in voice chat mode
        sendMessage(text, 'voice');
      },
      onVoiceChatEnd: function () {
        // Called when voice chat mode ends
        voiceChatActive = false;
        var vcBtn = $('voice-chat-btn');
        if (vcBtn) {
          vcBtn.classList.remove('active');
          vcBtn.setAttribute('aria-pressed', 'false');
        }
      }
    });
  }

  // Expose onVoiceChatEnd for voice.js to call
  window.App = {
    onVoiceChatEnd: function () {
      voiceChatActive = false;
      var vcBtn = $('voice-chat-btn');
      if (vcBtn) {
        vcBtn.classList.remove('active');
        vcBtn.setAttribute('aria-pressed', 'false');
      }
    }
  };

  // ---------------------- Auth events ----------------------

  var authForm = $('auth-form');
  if (authForm) authForm.addEventListener('submit', handleAuthSubmit);

  var authSwitch = $('auth-switch-btn');
  if (authSwitch) {
    authSwitch.addEventListener('click', function () {
      showAuthModal(authMode === 'login' ? 'signup' : 'login');
    });
  }

  var oauthGoogle = $('oauth-google');
  if (oauthGoogle) {
    oauthGoogle.addEventListener('click', function () {
      window.location.assign('/api/auth/google');
    });
  }

  var oauthGithub = $('oauth-github');
  if (oauthGithub) {
    oauthGithub.addEventListener('click', function () {
      window.location.assign('/api/auth/github');
    });
  }

  var logoutBtn = $('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      logout();
    });
  }

  // ---------------------- Boot ----------------------

  async function boot() {
    UI.setTheme(ChatStorage.loadTheme());

    try {
      var configRes = await fetch('/api/config');
      var config = await configRes.json();
      authEnabled = !!config.authEnabled;
      providers = config.providers || {};
    } catch (err) {
      authEnabled = false;
      providers = {};
    }
    updateOAuthButtons();

    // Handle OAuth redirect (token or error) before deciding the login flow.
    consumeOAuthHash();

    if (!authEnabled) {
      updateUserBox();
      chats = ChatStorage.loadChats();
      if (chats.length) {
        selectChat(chats[0].id);
      } else {
        startNewChat();
      }
      updateSendState();
      return;
    }

    token = null;
    try {
      var storedToken = localStorage.getItem('askgpt_token');
      if (storedToken) token = storedToken;
    } catch (err) {
      token = null;
    }

    if (!token) {
      startNewChat();
      showAuthModal('login');
      if (pendingAuthError) showAuthError(pendingAuthError);
      updateSendState();
      return;
    }

    try {
      var meRes = await fetch('/api/auth/me', { headers: authHeaders() });
      var me = await meRes.json();
      if (!meRes.ok || !me.user) throw new Error('UNAUTHORIZED');
      currentUser = me.user.email;
      updateUserBox();
      await loadChatsFromServer();
    } catch (err) {
      setToken(null);
      currentUser = null;
      updateUserBox();
      startNewChat();
      showAuthModal('login');
      if (pendingAuthError) showAuthError(pendingAuthError);
    }

    updateSendState();
  }

  boot();
});