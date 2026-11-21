// Chats routes (protected): CRUD for a user's chats
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const auth = require('../middleware/auth');

router.use(auth);

function serialize(chat) {
  return {
    id: String(chat._id),
    title: chat.title,
    messages: chat.messages || [],
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

router.get('/', async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.userId }).sort({ updatedAt: -1 });
    return res.json({ chats: chats.map(serialize) });
  } catch (err) {
    console.error('List chats error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/', async (req, res) => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title : 'New chat';
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];

    const chat = await Chat.create({
      userId: req.userId,
      title,
      messages,
    });

    return res.status(201).json({ chat: serialize(chat) });
  } catch (err) {
    console.error('Create chat error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const chat = await Chat.findOne({ _id: req.params.id, userId: req.userId });
    if (!chat) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    if (typeof req.body.title === 'string') {
      chat.title = req.body.title;
    }
    if (Array.isArray(req.body.messages)) {
      chat.messages = req.body.messages;
    }

    await chat.save();
    return res.json({ chat: serialize(chat) });
  } catch (err) {
    console.error('Update chat error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const chat = await Chat.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!chat) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete chat error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;