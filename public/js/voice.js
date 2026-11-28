// voice.js — speech input and output: init, speak, stop, stopListening,
// isSpeaking, startVoiceChat, stopVoiceChat

const Voice = (function () {
  'use strict';

  const RECOGNITION_LANG_DEFAULT = 'hi-IN';
  const SPEECH_MAX_CHUNK = 190;

  let recognition = null;
  let recognitionRunning = false;
  let onTranscript = null;
  let onStateChange = null;

  let speaking = false;
  let speakToken = 0;
  let currentUtterance = null;

  // Voice conversation mode state
  let voiceChatActive = false;
  let voiceChatMuted = false;
  let voiceChatRecognition = null;
  let voiceChatRecognitionRunning = false;
  let voiceChatSilenceTimer = null;
  let voiceChatTotalSilenceTimer = null;
  let voiceChatState = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
  let voiceChatCallbacks = null;

  const synth = window.speechSynthesis || null;

  function el(id) {
    return document.getElementById(id);
  }

  function selectedLang() {
    const select = el('lang-select');
    const value = select && select.value ? select.value : RECOGNITION_LANG_DEFAULT;
    return value === 'en-IN' ? 'en-IN' : 'hi-IN';
  }

  function voiceChatSelectedLang() {
    const select = el('voice-chat-lang-select');
    const value = select && select.value ? select.value : RECOGNITION_LANG_DEFAULT;
    return value === 'en-IN' ? 'en-IN' : 'hi-IN';
  }

  function setMicState(listening) {
    const mic = el('mic-btn');
    if (mic) {
      mic.classList.toggle('listening', !!listening);
      mic.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
    }
    if (typeof onStateChange === 'function') {
      try {
        onStateChange(!!listening);
      } catch (err) {
        /* ignore listener errors */
      }
    }
  }

  function setVoiceChatState(state) {
    voiceChatState = state;
    const circle = el('voice-chat-circle');
    const status = el('voice-chat-status');
    if (circle) {
      circle.classList.remove('listening', 'thinking', 'speaking');
      if (state !== 'idle') circle.classList.add(state);
    }
    if (status) {
      var texts = {
        listening: 'Sun rahi hoon...',
        thinking: 'Soch rahi hoon...',
        speaking: 'Bol rahi hoon...',
        idle: ''
      };
      var lang = detectMessageLang(status.textContent || '');
      if (lang === 'hi') {
        texts = {
          listening: 'Sun rahi hoon...',
          thinking: 'Soch rahi hoon...',
          speaking: 'Bol rahi hoon...',
          idle: ''
        };
      } else if (lang === 'hi-en') {
        texts = {
          listening: 'Sun rahi hoon...',
          thinking: 'Soch rahi hoon...',
          speaking: 'Bol rahi hoon...',
          idle: ''
        };
      } else {
        texts = {
          listening: 'Listening...',
          thinking: 'Thinking...',
          speaking: 'Speaking...',
          idle: ''
        };
      }
      status.textContent = texts[state] || '';
    }
  }

  function toast(message, ms) {
    const composer = el('composer');
    if (!composer) return;

    let node = document.getElementById('voice-toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'voice-toast';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:96px',
        'transform:translateX(-50%)',
        'max-width:min(320px, 90vw)',
        'padding:9px 14px',
        'border-radius:999px',
        'background:#1f2024',
        'color:#ffffff',
        'font-size:13px',
        'line-height:1.4',
        'text-align:center',
        'box-shadow:0 6px 18px rgba(0,0,0,0.25)',
        'z-index:1000',
        'pointer-events:none',
        'transition:opacity 200ms ease',
        'opacity:0',
      ].join(';');
      document.body.appendChild(node);
    }

    node.textContent = message;
    node.style.opacity = '1';

    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(function () {
      node.style.opacity = '0';
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 220);
    }, ms || 3000);
  }

  function recognitionErrorText(err) {
    const code = err && err.error ? err.error : '';
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      return 'Microphone permission needed. Allow mic access in your browser.';
    }
    if (code === 'no-speech') {
      return 'No speech detected. Try again.';
    }
    if (code === 'audio-capture') {
      return 'No microphone found on this device.';
    }
    if (code === 'network') {
      return 'Speech recognition needs an internet connection.';
    }
    if (code === 'aborted') {
      return '';
    }
    return 'Voice input stopped working. Please try again.';
  }

  function getRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function stopListening() {
    if (recognition && recognitionRunning) {
      try {
        recognition.stop();
      } catch (err) {
        /* ignore */
      }
    }
    recognitionRunning = false;
    setMicState(false);
  }

  function startListening() {
    if (!recognition) {
      toast('Voice input works in Chrome or Edge.');
      return;
    }

    if (recognitionRunning) {
      stopListening();
      return;
    }

    try {
      recognition._finalText = '';
      recognition.lang = selectedLang();
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = function () {
        recognitionRunning = true;
        setMicState(true);
      };

      recognition.onresult = function (event) {
        let interim = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0] ? result[0].transcript : '';
          if (result.isFinal) {
            finalText += text;
          } else {
            interim += text;
          }
        }

        const input = el('user-input');
        if (input && interim) {
          input.value = interim;
          if (window.UI && typeof window.UI.autoGrow === 'function') {
            window.UI.autoGrow(input);
          }
        }

        if (finalText.trim()) {
          recognition._finalText = (recognition._finalText || '') + finalText;
        }
      };

      recognition.onerror = function (event) {
        const message = recognitionErrorText(event);
        if (message) toast(message);
        recognitionRunning = false;
        setMicState(false);
      };

      recognition.onend = function () {
        const finalText = (recognition._finalText || '').trim();
        recognition._finalText = '';
        recognitionRunning = false;
        setMicState(false);

        const input = el('user-input');
        if (input && !input.value.trim()) {
          input.value = '';
        }

        if (finalText && typeof onTranscript === 'function') {
          onTranscript(finalText);
        }
      };

      recognition.start();
    } catch (err) {
      recognitionRunning = false;
      setMicState(false);
      toast('Could not start voice input. Try again.');
    }
  }

  function init(options) {
    const opts = options || {};
    onTranscript = typeof opts.onTranscript === 'function' ? opts.onTranscript : null;
    onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : null;

    const Ctor = getRecognitionCtor();
    const mic = el('mic-btn');

    if (!Ctor) {
      if (mic) {
        mic.title = 'Voice input works in Chrome or Edge';
        mic.setAttribute('aria-disabled', 'true');
        mic.setAttribute('aria-label', 'Voice input unavailable');
        mic.style.opacity = '0.45';
        mic.style.cursor = 'not-allowed';
        mic.addEventListener('click', function () {
          toast('Voice input works in Chrome or Edge.');
        });
      }
      return;
    }

    recognition = new Ctor();

    if (mic) {
      mic.addEventListener('click', function () {
        if (recognitionRunning) {
          stopListening();
        } else {
          stop();
          startListening();
        }
      });
    }

    const stopBtn = el('stop-speaking-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        stop();
      });
    }
  }

  // ------------------------- Speaking -------------------------

  function stripMarkdown(text) {
    let out = String(text == null ? '' : text);

    out = out.replace(/```[^\n]*\n([\s\S]*?)```/g, ' $1 ');
    out = out.replace(/~~~[^\n]*\n([\s\S]*?)~~~/g, ' $1 ');
    out = out.replace(/`([^`]*)`/g, '$1');
    out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    out = out.replace(/^\s{0,3}>\s?/gm, '');
    out = out.replace(/^\s{0,3}([-*_])\s*(\1\s*){2,}$/gm, '');
    out = out.replace(/^\s*[-*+]\s+/gm, '');
    out = out.replace(/^\s*\d+[.)]\s+/gm, '');
    out = out.replace(/(\*\*|__)(.*?)\1/g, '$2');
    out = out.replace(/(\*|_)(.*?)\1/g, '$2');
    out = out.replace(/~~(.*?)~~/g, '$1');
    out = out.replace(/\|/g, ' ');
    out = out.replace(/^\s*[-:| ]+[-:| ]*$/gm, '');

    // Remove emojis
    out = out.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
    // Remove URLs
    out = out.replace(/https?:\/\/\S+/g, '');

    out = out.replace(/\s+/g, ' ').trim();
    return out;
  }

  function hasDevanagari(text) {
    return /[\u0900-\u097F]/.test(text);
  }

  function detectLang(text) {
    if (hasDevanagari(text)) return 'hi-IN';
    return selectedLang();
  }

  function detectMessageLang(text) {
    var value = String(text == null ? '' : text);
    if (/[\u0900-\u097F]/.test(value)) return 'hi';

    var words = value.toLowerCase().split(/[^a-z]+/);
    var HINGLISH_WORDS = [
      'kya', 'kaise', 'kaisa', 'kaisi', 'hai', 'hain', 'nahi', 'nahin', 'kar', 'karo',
      'karne', 'kro', 'batao', 'bata', 'mujhe', 'aap', 'tum', 'yaar', 'acha', 'accha',
      'haan', 'kaun', 'kyun', 'kyu', 'kab', 'kahan', 'chahiye', 'hua', 'ho', 'raha',
      'rahe', 'rahi', 'tha', 'thi', 'yeh', 'woh', 'wala', 'wali', 'matlab', 'samjha',
      'samjhao', 'bhejo', 'likho', 'likh', 'sunao', 'suno', 'thik', 'bahut', 'jyada',
      'kam', 'krna', 'karlo', 'bhej', 'do', 'hindi', 'mein', 'par', 'aur', 'lekin'
    ];
    for (var i = 0; i < words.length; i += 1) {
      if (HINGLISH_WORDS.indexOf(words[i]) !== -1) return 'hi-en';
    }
    return 'en';
  }

  function pickVoice(lang) {
    if (!synth) return null;

    const voices = synth.getVoices() || [];
    if (!voices.length) return null;

    const exact = voices.filter(function (v) {
      return v && v.lang && v.lang.toLowerCase() === lang.toLowerCase();
    });
    if (exact.length) return exact[0];

    const base = lang.split('-')[0].toLowerCase();
    const partial = voices.filter(function (v) {
      return v && v.lang && v.lang.toLowerCase().indexOf(base) === 0;
    });
    if (partial.length) return partial[0];

    return null;
  }

  function chunkText(text, maxSentences) {
    const clean = stripMarkdown(text);
    if (!clean) return [];

    // If over 600 chars, take only first 3 sentences
    if (clean.length > 600 && maxSentences) {
      const sentences = clean.match(/[^.!?।]+[.!?।]/g) || [clean];
      if (sentences.length > maxSentences) {
        return [sentences.slice(0, maxSentences).join(' ').trim()];
      }
    }

    const chunks = [];
    let rest = clean;

    while (rest.length > SPEECH_MAX_CHUNK) {
      let cut = -1;
      const slice = rest.slice(0, SPEECH_MAX_CHUNK);

      const sentence = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf('। ')
      );
      if (sentence > 40) {
        cut = sentence + 1;
      } else {
        const comma = slice.lastIndexOf(', ');
        if (comma > 60) {
          cut = comma + 1;
        } else {
          const space = slice.lastIndexOf(' ');
          cut = space > 0 ? space + 1 : SPEECH_MAX_CHUNK;
        }
      }

      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }

    if (rest) chunks.push(rest);
    return chunks.filter(Boolean);
  }

  function hideStopButton() {
    const btn = el('stop-speaking-btn');
    if (btn) btn.hidden = true;
  }

  function showStopButton() {
    const btn = el('stop-speaking-btn');
    if (btn) btn.hidden = false;
  }

  function speakNext(token, chunks, index, lang) {
    if (token !== speakToken) return;

    if (index >= chunks.length) {
      speaking = false;
      currentUtterance = null;
      hideStopButton();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    currentUtterance = utterance;

    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.lang = lang;
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = function () {
      if (token !== speakToken) return;
      speakNext(token, chunks, index + 1, lang);
    };

    utterance.onerror = function () {
      if (token !== speakToken) return;
      speaking = false;
      currentUtterance = null;
      hideStopButton();
    };

    synth.speak(utterance);
  }

  function speak(text) {
    const content = String(text == null ? '' : text);
    const chunks = chunkText(content);

    if (!synth) {
      toast('Read aloud is not supported in this browser.');
      return;
    }

    stop();

    if (!chunks.length) return;

    const lang = detectLang(content);
    const token = ++speakToken;

    speaking = true;
    showStopButton();

    let begun = false;
    const begin = function () {
      if (begun || token !== speakToken) return;
      begun = true;
      speakNext(token, chunks, 0, lang);
    };

    const voices = synth.getVoices() || [];
    if (!voices.length && typeof synth.addEventListener === 'function') {
      const handler = function () {
        synth.removeEventListener('voiceschanged', handler);
        begin();
      };
      synth.addEventListener('voiceschanged', handler);
      window.setTimeout(function () {
        synth.removeEventListener('voiceschanged', handler);
        begin();
      }, 600);
    } else {
      begin();
    }
  }

  function stop() {
    speakToken += 1;
    speaking = false;

    if (synth) {
      try {
        synth.cancel();
      } catch (err) {
        /* ignore */
      }
    }

    currentUtterance = null;
    hideStopButton();
  }

  function isSpeaking() {
    return !!speaking;
  }

  // ------------------------- Voice Conversation -------------------------

  function getVoiceChatRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function clearVoiceChatTimers() {
    if (voiceChatSilenceTimer) {
      clearTimeout(voiceChatSilenceTimer);
      voiceChatSilenceTimer = null;
    }
    if (voiceChatTotalSilenceTimer) {
      clearTimeout(voiceChatTotalSilenceTimer);
      voiceChatTotalSilenceTimer = null;
    }
  }

  function setVoiceChatUserTranscript(text) {
    const el = document.getElementById('voice-chat-user-transcript');
    if (el) el.textContent = text;
  }

  function setVoiceChatBotTranscript(text) {
    const el = document.getElementById('voice-chat-bot-transcript');
    if (el) el.textContent = text;
  }

  function startVoiceChatRecognition() {
    if (voiceChatMuted || voiceChatRecognitionRunning) return;

    const Ctor = getVoiceChatRecognitionCtor();
    if (!Ctor) {
      showVoiceChatError('Voice conversation works in Chrome or Edge.');
      return;
    }

    try {
      voiceChatRecognition = new Ctor();
      voiceChatRecognition.lang = voiceChatSelectedLang();
      voiceChatRecognition.interimResults = true;
      voiceChatRecognition.continuous = true;
      voiceChatRecognition.maxAlternatives = 1;

      let interimText = '';
      let finalText = '';
      let lastFinalTime = Date.now();

      voiceChatRecognition.onstart = function () {
        voiceChatRecognitionRunning = true;
        setVoiceChatState('listening');
      };

      voiceChatRecognition.onresult = function (event) {
        interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0] ? result[0].transcript : '';
          if (result.isFinal) {
            finalText += text + ' ';
            lastFinalTime = Date.now();
          } else {
            interimText += text;
          }
        }
        setVoiceChatUserTranscript((finalText + interimText).trim());
      };

      voiceChatRecognition.onerror = function (event) {
        const code = event && event.error ? event.error : '';
        if (code === 'no-speech') {
          // No speech detected, restart after a moment
          setTimeout(function () {
            if (voiceChatActive && !voiceChatMuted) {
              startVoiceChatRecognition();
            }
          }, 500);
          return;
        }
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          showVoiceChatError('Microphone permission needed. Allow mic access in your browser.');
        } else if (code === 'audio-capture') {
          showVoiceChatError('No microphone found on this device.');
        } else if (code === 'network') {
          showVoiceChatError('Speech recognition needs an internet connection.');
        } else if (code !== 'aborted') {
          showVoiceChatError('Voice input stopped working. Please try again.');
        }
        voiceChatRecognitionRunning = false;
      };

      voiceChatRecognition.onend = function () {
        voiceChatRecognitionRunning = false;
        if (voiceChatActive && !voiceChatMuted && voiceChatState !== 'speaking' && voiceChatState !== 'thinking') {
          // Restart recognition after a brief pause
          setTimeout(function () {
            if (voiceChatActive && !voiceChatMuted) {
              startVoiceChatRecognition();
            }
          }, 300);
        }
      };

      voiceChatRecognition.start();

      // 8-second silence timer for "Kuch sunai nahi diya"
      voiceChatSilenceTimer = setTimeout(function () {
        if (voiceChatActive && voiceChatState === 'listening') {
          showVoiceChatError('Kuch sunai nahi diya');
        }
      }, 8000);

      // 30-second total silence timer to auto-end
      voiceChatTotalSilenceTimer = setTimeout(function () {
        if (voiceChatActive) {
          showVoiceChatError('No activity for 30 seconds. Ending voice conversation.');
          setTimeout(function () {
            stopVoiceChat();
          }, 2000);
        }
      }, 30000);

    } catch (err) {
      voiceChatRecognitionRunning = false;
      showVoiceChatError('Could not start voice conversation. Try again.');
    }
  }

  function stopVoiceChatRecognition() {
    clearVoiceChatTimers();
    if (voiceChatRecognition && voiceChatRecognitionRunning) {
      try {
        voiceChatRecognition.stop();
      } catch (err) {
        /* ignore */
      }
    }
    voiceChatRecognitionRunning = false;
    voiceChatRecognition = null;
  }

  function showVoiceChatError(message) {
    const status = document.getElementById('voice-chat-status');
    if (status) {
      status.textContent = message;
      status.style.color = 'var(--danger)';
      setTimeout(function () {
        if (status) status.style.color = '';
      }, 3000);
    }
  }

  function startVoiceChat(callbacks) {
    if (voiceChatActive) return;

    const Ctor = getVoiceChatRecognitionCtor();
    if (!Ctor) {
      toast('Voice conversation works in Chrome or Edge.');
      if (callbacks && typeof callbacks.onError === 'function') {
        callbacks.onError('Voice conversation works in Chrome or Edge.');
      }
      return;
    }

    voiceChatActive = true;
    voiceChatMuted = false;
    voiceChatCallbacks = callbacks || {};

    const overlay = document.getElementById('voice-chat-overlay');
    if (overlay) overlay.hidden = false;

    // Update language select from main dropdown
    const mainLang = document.getElementById('lang-select');
    const vcLang = document.getElementById('voice-chat-lang-select');
    if (mainLang && vcLang) vcLang.value = mainLang.value;

    setVoiceChatState('listening');
    setVoiceChatUserTranscript('');
    setVoiceChatBotTranscript('');

    // Set up button handlers
    const endBtn = document.getElementById('voice-chat-end');
    const muteBtn = document.getElementById('voice-chat-mute');
    const closeBtn = document.getElementById('voice-chat-close');
    const langSelect = document.getElementById('voice-chat-lang-select');

    if (endBtn) {
      endBtn.onclick = function () { stopVoiceChat(); };
    }
    if (closeBtn) {
      closeBtn.onclick = function () { stopVoiceChat(); };
    }
    if (muteBtn) {
      muteBtn.onclick = function () {
        voiceChatMuted = !voiceChatMuted;
        muteBtn.setAttribute('aria-pressed', voiceChatMuted ? 'true' : 'false');
        muteBtn.classList.toggle('muted', voiceChatMuted);
        if (voiceChatMuted) {
          stopVoiceChatRecognition();
          setVoiceChatState('idle');
        } else {
          startVoiceChatRecognition();
        }
      };
    }
    if (langSelect) {
      langSelect.onchange = function () {
        if (voiceChatRecognitionRunning) {
          stopVoiceChatRecognition();
          setTimeout(startVoiceChatRecognition, 300);
        }
      };
    }

    // Circle click handler: interrupt bot speech and start listening
    const circle = document.getElementById('voice-chat-circle');
    if (circle) {
      circle.onclick = function () {
        if (voiceChatState === 'speaking' || voiceChatState === 'thinking') {
          interruptVoiceChat();
        }
      };
    }

    // Start listening
    startVoiceChatRecognition();
  }

  function stopVoiceChat() {
    if (!voiceChatActive) return;

    voiceChatActive = false;
    stopVoiceChatRecognition();
    stop(); // Stop any ongoing speech

    const overlay = document.getElementById('voice-chat-overlay');
    if (overlay) overlay.hidden = true;

    setVoiceChatState('idle');

    // Clean up button handlers
    const endBtn = document.getElementById('voice-chat-end');
    const muteBtn = document.getElementById('voice-chat-mute');
    const closeBtn = document.getElementById('voice-chat-close');
    if (endBtn) endBtn.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
    if (muteBtn) muteBtn.onclick = null;

    voiceChatCallbacks = null;

    // Notify app that voice chat ended
    if (window.App && typeof window.App.onVoiceChatEnd === 'function') {
      try {
        window.App.onVoiceChatEnd();
      } catch (err) {
        /* ignore */
      }
    }
  }

  function onVoiceChatUserTranscript(finalText) {
    if (!voiceChatActive || voiceChatMuted) return;
    if (!finalText.trim()) return;

    clearVoiceChatTimers();
    stopVoiceChatRecognition();

    // Don't start listening while bot is speaking
    if (voiceChatState === 'speaking' || voiceChatState === 'thinking') return;

    setVoiceChatState('thinking');

    // Send to app for processing
    if (voiceChatCallbacks && typeof voiceChatCallbacks.onTranscript === 'function') {
      voiceChatCallbacks.onTranscript(finalText.trim());
    }
  }

  function onVoiceChatBotReply(replyText) {
    if (!voiceChatActive) return;

    setVoiceChatBotTranscript(replyText);
    setVoiceChatState('speaking');

    // Speak the reply (first 3 sentences if long)
    const chunks = chunkText(replyText, 3);
    if (!chunks.length) {
      // No speakable content, go back to listening
      setTimeout(function () {
        if (voiceChatActive) startVoiceChatRecognition();
      }, 500);
      return;
    }

    if (!synth) {
      // No speech synthesis, go back to listening
      setTimeout(function () {
        if (voiceChatActive) startVoiceChatRecognition();
      }, 500);
      return;
    }

    const lang = detectLang(replyText);
    const token = ++speakToken;
    speaking = true;

    function speakNextVc(index) {
      if (token !== speakToken || !voiceChatActive) {
        speaking = false;
        return;
      }
      if (index >= chunks.length) {
        speaking = false;
        // After speaking, start listening again
        setTimeout(function () {
          if (voiceChatActive && !voiceChatMuted) {
            startVoiceChatRecognition();
          }
        }, 500);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
      utterance.lang = lang;
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onend = function () {
        if (token !== speakToken || !voiceChatActive) return;
        speakNextVc(index + 1);
      };
      utterance.onerror = function () {
        if (token !== speakToken || !voiceChatActive) return;
        speaking = false;
        setTimeout(function () {
          if (voiceChatActive && !voiceChatMuted) {
            startVoiceChatRecognition();
          }
        }, 500);
      };

      synth.speak(utterance);
    }

    // Wait for voices if needed
    const voices = synth.getVoices() || [];
    if (!voices.length && typeof synth.addEventListener === 'function') {
      const handler = function () {
        synth.removeEventListener('voiceschanged', handler);
        speakNextVc(0);
      };
      synth.addEventListener('voiceschanged', handler);
      window.setTimeout(function () {
        synth.removeEventListener('voiceschanged', handler);
        speakNextVc(0);
      }, 600);
    } else {
      speakNextVc(0);
    }
  }

  function interruptVoiceChat() {
    if (!voiceChatActive) return;
    stop(); // Stop current speech
    if (voiceChatState === 'speaking' || voiceChatState === 'thinking') {
      setVoiceChatState('listening');
      startVoiceChatRecognition();
    }
  }

  function isVoiceChatActive() {
    return voiceChatActive;
  }

  return {
    init: init,
    speak: speak,
    stop: stop,
    stopListening: stopListening,
    isSpeaking: isSpeaking,
    startVoiceChat: startVoiceChat,
    stopVoiceChat: stopVoiceChat,
    onVoiceChatUserTranscript: onVoiceChatUserTranscript,
    onVoiceChatBotReply: onVoiceChatBotReply,
    interruptVoiceChat: interruptVoiceChat,
    isVoiceChatActive: isVoiceChatActive,
  };
})();

window.Voice = Voice;