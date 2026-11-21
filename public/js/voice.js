// voice.js — speech input and output: init, speak, stop, stopListening,
// isSpeaking

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

  const synth = window.speechSynthesis || null;

  function el(id) {
    return document.getElementById(id);
  }

  function selectedLang() {
    const select = el('lang-select');
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

  function chunkText(text) {
    const clean = stripMarkdown(text);
    if (!clean) return [];

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

  return {
    init: init,
    speak: speak,
    stop: stop,
    stopListening: stopListening,
    isSpeaking: isSpeaking,
  };
})();

window.Voice = Voice;