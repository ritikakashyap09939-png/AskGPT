// storage.js — localStorage helpers for chats and theme

const STORAGE_KEY = 'askgpt_chats_v1';
const THEME_KEY = 'askgpt_theme';

const ChatStorage = {
  /** Load all chats (array of {id, title, messages: []}) */
  loadChats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('Failed to load chats', e);
      return [];
    }
  },

  /** Save chats array */
  saveChats(chats) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch (e) {
      console.warn('Failed to save chats', e);
    }
  },

  /** Create a new chat and return it */
  createChat(title = 'New chat') {
    const chats = this.loadChats();
    const chat = {
      id: 'chat_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      title,
      messages: [],
      createdAt: Date.now(),
    };
    chats.unshift(chat);
    this.saveChats(chats);
    return chat;
  },

  /** Update an existing chat (messages / title) */
  updateChat(chat) {
    const chats = this.loadChats();
    const idx = chats.findIndex(c => c.id === chat.id);
    if (idx !== -1) {
      chats[idx] = chat;
      this.saveChats(chats);
    }
  },

  /** Delete a chat by id */
  deleteChat(id) {
    const chats = this.loadChats().filter(c => c.id !== id);
    this.saveChats(chats);
  },

  /** Load theme: 'light' or 'dark' */
  loadTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
  },

  /** Save theme */
  saveTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
  },
};