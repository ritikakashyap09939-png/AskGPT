// ui.js — DOM helpers: showWelcome, addUserMessage, addBotMessage,
// showTyping, removeTyping, renderMarkdown, addActions, scrollToBottom,
// renderChatList, renderMessages, setTheme, openSidebar, closeSidebar,
// autoGrow

const UI = (function () {
  'use strict';

  let typingEl = null;

  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function withLineBreaks(str) {
    return escapeHtml(str).replace(/\r\n|\r|\n/g, '<br />');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  function messagesEl() {
    return document.getElementById('messages');
  }

  function showWelcome(show) {
    const welcome = document.getElementById('welcome');
    const messages = messagesEl();
    if (welcome) welcome.hidden = !show;
    if (messages) messages.hidden = !!show;
  }

  function addUserMessage(text, imageSrc) {
    const root = document.createElement('div');
    root.className = 'message user';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = 'U';

    const content = document.createElement('div');
    content.className = 'message-content';

    if (imageSrc) {
      const img = document.createElement('img');
      img.className = 'msg-image';
      img.src = imageSrc;
      img.alt = 'Attached image';
      content.appendChild(img);
    }

    if (text) {
      const textEl = document.createElement('div');
      textEl.className = 'msg-text';
      textEl.innerHTML = withLineBreaks(text);
      content.appendChild(textEl);
    }

    root.appendChild(avatar);
    root.appendChild(content);

    const list = messagesEl();
    if (list) {
      list.hidden = false;
      const welcome = document.getElementById('welcome');
      if (welcome) welcome.hidden = true;
      list.appendChild(root);
    }

    return root;
  }

  function addBotMessage() {
    const root = document.createElement('div');
    root.className = 'message bot';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = 'A';

    const content = document.createElement('div');
    content.className = 'message-content';

    root.appendChild(avatar);
    root.appendChild(content);

    const list = messagesEl();
    if (list) {
      list.hidden = false;
      const welcome = document.getElementById('welcome');
      if (welcome) welcome.hidden = true;
      list.appendChild(root);
    }

    return { root: root, content: content };
  }

  function showTyping() {
    const bot = addBotMessage();
    const dots = document.createElement('div');
    dots.className = 'typing-dots';
    dots.setAttribute('aria-label', 'Assistant is typing');
    dots.innerHTML = '<span></span><span></span><span></span>';
    bot.content.appendChild(dots);
    typingEl = dots;
    scrollToBottom();
    return dots;
  }

  function removeTyping() {
    if (typingEl && typingEl.parentNode) {
      const root = typingEl.closest('.message');
      if (root && root.parentNode) {
        root.parentNode.removeChild(root);
      } else {
        typingEl.parentNode.removeChild(typingEl);
      }
    }
    typingEl = null;
  }

  function decorateCodeBlocks(scope) {
    if (!(scope instanceof Element)) return;

    const pres = Array.prototype.slice.call(scope.querySelectorAll('pre'));
    pres.forEach((pre) => {
      if (pre.parentNode && pre.parentNode.classList.contains('code-block')) {
        return;
      }

      const code = pre.querySelector('code');
      const rawCode = code ? code.textContent : pre.textContent;

      let lang = 'code';
      if (code) {
        const m = (code.className || '').match(/language-([\w+-]+)/);
        if (m) lang = m[1];
        if (window.hljs) {
          try {
            window.hljs.highlightElement(code);
          } catch (err) {
            /* highlight is best-effort */
          }
        }
      }

      const block = document.createElement('div');
      block.className = 'code-block';

      const header = document.createElement('div');
      header.className = 'code-header';

      const langEl = document.createElement('span');
      langEl.className = 'code-lang';
      langEl.textContent = lang;

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.setAttribute('aria-label', 'Copy code');
      copyBtn.addEventListener('click', function () {
        copyText(rawCode)
          .then(function () {
            const original = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            window.setTimeout(function () {
              copyBtn.textContent = original;
            }, 1500);
          })
          .catch(function () {
            copyBtn.textContent = 'Failed';
            window.setTimeout(function () {
              copyBtn.textContent = 'Copy';
            }, 1500);
          });
      });

      header.appendChild(langEl);
      header.appendChild(copyBtn);

      pre.parentNode.insertBefore(block, pre);
      block.appendChild(header);
      block.appendChild(pre);
    });
  }

  function renderMarkdown(el, text) {
    if (!el) return;

    if (window.marked && typeof window.marked.parse === 'function') {
      el.innerHTML = window.marked.parse(String(text == null ? '' : text));
    } else {
      el.innerHTML = withLineBreaks(text);
    }

    decorateCodeBlocks(el);
  }

  function addActions(botMessage, getText) {
    if (!botMessage || !botMessage.content) return null;

    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', 'Copy message');
    copyBtn.textContent = '⧉';
    copyBtn.addEventListener('click', function () {
      let text = '';
      try {
        text = typeof getText === 'function' ? getText() : botMessage.content.textContent;
      } catch (err) {
        text = botMessage.content.textContent;
      }
      copyText(text || '').catch(function () {});
    });

    const speakBtn = document.createElement('button');
    speakBtn.className = 'msg-action-btn';
    speakBtn.type = 'button';
    speakBtn.setAttribute('aria-label', 'Read aloud');
    speakBtn.textContent = '🔊';
    speakBtn.addEventListener('click', function () {
      let text = '';
      try {
        text = typeof getText === 'function' ? getText() : botMessage.content.textContent;
      } catch (err) {
        text = botMessage.content.textContent;
      }
      if (window.Voice && typeof window.Voice.speak === 'function') {
        window.Voice.speak(text || '');
      }
    });

    actions.appendChild(copyBtn);
    actions.appendChild(speakBtn);
    botMessage.content.appendChild(actions);

    return actions;
  }

  function scrollToBottom() {
    const scroller = document.getElementById('chat-scroll');
    if (!scroller) return;
    const reduce =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: reduce ? 'auto' : 'smooth',
    });
  }

  function renderChatList(chats, activeId, handlers) {
    const list = document.getElementById('chat-list');
    if (!list) return;

    const opts = handlers || {};
    list.innerHTML = '';

    (chats || []).forEach(function (chat) {
      const li = document.createElement('li');
      li.className = 'chat-item';
      if (chat.id === activeId) li.classList.add('active');
      li.setAttribute('data-id', chat.id);
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');

      const title = document.createElement('span');
      title.className = 'chat-title';
      title.textContent = chat.title || 'New chat';

      const del = document.createElement('button');
      del.className = 'chat-delete';
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete chat');
      del.textContent = '×';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (typeof opts.onDelete === 'function') opts.onDelete(chat.id);
      });

      li.appendChild(title);
      li.appendChild(del);

      li.addEventListener('click', function () {
        if (typeof opts.onSelect === 'function') opts.onSelect(chat.id);
      });

      li.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          if (typeof opts.onSelect === 'function') opts.onSelect(chat.id);
        }
      });

      list.appendChild(li);
    });
  }

  function renderMessages(messages) {
    const list = messagesEl();
    if (!list) return;

    list.innerHTML = '';
    typingEl = null;

    const welcome = document.getElementById('welcome');
    const items = messages || [];

    if (!items.length) {
      if (welcome) welcome.hidden = false;
      list.hidden = true;
      return;
    }

    if (welcome) welcome.hidden = true;
    list.hidden = false;

    items.forEach(function (msg) {
      if (msg.role === 'user') {
        addUserMessage(msg.content || '');
      } else {
        const bot = addBotMessage();
        renderMarkdown(bot.content, msg.content || '');
        addActions(bot, function () {
          return bot.content.textContent;
        });
      }
    });
  }

  function setTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
      const label = toggle.querySelector('.theme-toggle-label');
      if (label) label.textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
    }
  }

  function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.hidden = false;
  }

  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.hidden = true;
  }

  function autoGrow(textarea) {
    if (!textarea) return;
    const max = 160;
    textarea.style.height = 'auto';
    const next = Math.min(textarea.scrollHeight, max);
    textarea.style.height = next + 'px';
    textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
  }

  return {
    showWelcome: showWelcome,
    addUserMessage: addUserMessage,
    addBotMessage: addBotMessage,
    showTyping: showTyping,
    removeTyping: removeTyping,
    renderMarkdown: renderMarkdown,
    addActions: addActions,
    scrollToBottom: scrollToBottom,
    renderChatList: renderChatList,
    renderMessages: renderMessages,
    setTheme: setTheme,
    openSidebar: openSidebar,
    closeSidebar: closeSidebar,
    autoGrow: autoGrow,
  };
})();