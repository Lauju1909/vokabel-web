/**
 * portal.js – Vokabel-Web Portal
 * Integriert VokabelStar (Duolingo-Stil) & VokabelMeister (Schriftlich)
 * Mit 100% BFW Wirtschaftsenglisch Wortschatz, Barrierefreiheit (WCAG 2.2 AAA)
 * und automatischem GitHub-Update-System.
 */

// ==========================================
// 1. SOUND & TEXT-TO-SPEECH (TTS) SYSTEM
// ==========================================
class SoundSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playTone(freq, type, duration, delay = 0) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    setTimeout(() => {
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {
        console.warn("Audio play error:", e);
      }
    }, delay);
  }

  correct() {
    this.playTone(523.25, "sine", 0.12, 0);   // C5
    this.playTone(659.25, "sine", 0.18, 100); // E5
    this.playTone(783.99, "sine", 0.25, 200); // G5
  }

  almost() {
    this.playTone(440, "triangle", 0.15, 0);   // A4
    this.playTone(554.37, "triangle", 0.2, 120); // C#5
  }

  wrong() {
    this.playTone(330, "sawtooth", 0.15, 0);  // E4
    this.playTone(260, "sawtooth", 0.25, 120); // C4
  }

  levelUp() {
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      this.playTone(freq, "sine", 0.2, idx * 90);
    });
  }

  click() {
    this.playTone(800, "sine", 0.04, 0);
  }
}

class TTSSystem {
  constructor() {
    this.enabled = true;
    this.rate = 1.0;
  }

  speak(text, lang = "en-US") {
    if (!this.enabled || !window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = this.rate;

      // Select voice if available
      const voices = window.speechSynthesis.getVoices();
      const prefix = lang.split("-")[0].toLowerCase();
      const matched = voices.find(v => v.lang.toLowerCase().startsWith(prefix));
      if (matched) {
        utterance.voice = matched;
      }

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("TTS error:", e);
    }
  }
}

const sounds = new SoundSystem();
const tts = new TTSSystem();

// ==========================================
// 2. DAMERAU-LEVEHNSTEIN & FUZZY MATCHING (VokabelMeister)
// ==========================================
function damerauLevenshtein(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  const d = [];

  for (let i = 0; i <= len1 + 1; i++) {
    d[i] = [];
    for (let j = 0; j <= len2 + 1; j++) {
      d[i][j] = 0;
    }
  }

  for (let i = 0; i <= len1; i++) d[i + 1][1] = i;
  for (let j = 0; j <= len2; j++) d[1][j + 1] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i + 1][j + 1] = Math.min(
        d[i][j + 1] + 1,        // deletion
        d[i + 1][j + 1] + 1,    // insertion
        d[i][j] + cost          // substitution
      );
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        d[i + 1][j + 1] = Math.min(d[i + 1][j + 1], d[i - 1][j - 1] + 1); // transposition
      }
    }
  }
  return d[len1 + 1][len2 + 1];
}

function cleanStr(s) {
  if (!s) return "";
  let clean = s.replace(/[\(\)\[\]\{\}<>„“\"\'`´]/g, "");
  clean = clean.replace(/[.,!?;:]/g, " ");
  clean = clean.replace(/\s*([+=])\s*/g, " $1 ");
  return clean.toLowerCase().trim().replace(/\s+/g, " ");
}

function expandBrackets(text) {
  const pattern = /[\(\[\{]([^\)\]\}]*)[\)\]\}]/;
  function recurse(curr) {
    const m = curr.match(pattern);
    if (!m) return new Set([curr]);
    const withContent = curr.replace(m[0], " " + m[1] + " ");
    const withoutContent = curr.replace(m[0], " ");
    const setA = recurse(withContent);
    const setB = recurse(withoutContent);
    return new Set([...setA, ...setB]);
  }
  return recurse(text);
}

function expandSlashes(text) {
  const words = text.split(/\s+/);
  let combinations = [""];
  for (const w of words) {
    if (w.includes("/") && w.length > 1) {
      const parts = w.split("/").filter(p => p.length > 0);
      const nextCombos = [];
      for (const c of combinations) {
        for (const p of parts) {
          nextCombos.push((c + " " + p).trim());
        }
      }
      combinations = nextCombos;
    } else {
      combinations = combinations.map(c => (c + " " + w).trim());
    }
  }
  return new Set(combinations);
}

function generateAllowedAnswers(target) {
  const cleaned = target.trim();
  const allowed = new Set();
  const commaParts = cleaned.split(/[,;\n]+/).map(p => p.trim()).filter(p => p.length > 0);
  const candidates = commaParts.length > 0 ? commaParts : [cleaned];

  for (const cand of candidates) {
    const bracketVariants = expandBrackets(cand);
    for (const bVar of bracketVariants) {
      const slashVariants = expandSlashes(bVar);
      for (const sVar of slashVariants) {
        const c = cleanStr(sVar);
        if (c.length > 0) allowed.add(c);
      }
    }
  }
  return allowed;
}

function verifyAnswerFuzzy(userInput, expectedTarget) {
  const cleanedUser = cleanStr(userInput);
  const allowed = generateAllowedAnswers(expectedTarget);

  if (allowed.has(cleanedUser)) {
    return { status: "correct", message: "Perfekt! Exakt richtig." };
  }

  // Check fuzzy Damerau-Levenshtein
  let minDistance = 999;
  let bestMatch = "";
  for (const targetVariant of allowed) {
    const dist = damerauLevenshtein(cleanedUser, targetVariant);
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = targetVariant;
    }
  }

  const wordLen = bestMatch.length;
  let maxTypos = 0;
  if (wordLen > 3 && wordLen <= 7) maxTypos = 1;
  else if (wordLen > 7) maxTypos = 2;

  if (minDistance <= maxTypos && minDistance > 0) {
    return {
      status: "almost",
      message: `Fast richtig! (Tippfehler erkannt). Richtige Schreibweise: „${expectedTarget}“`
    };
  }

  return {
    status: "wrong",
    message: `Leider nicht ganz. Richtige Antwort: „${expectedTarget}“`
  };
}

// ==========================================
// 3. STORAGE & DATA MANAGER (MIT BFW-KATALOG)
// ==========================================
class DataManager {
  static KEY_DECKS = "vokabelportal_decks";
  static KEY_STATS = "vokabelportal_stats";
  static KEY_SETTINGS = "vokabelportal_settings";
  static KEY_BFW_UPDATE = "vokabelportal_bfw_cache";

  static getSettings() {
    const raw = localStorage.getItem(this.KEY_SETTINGS);
    const defaults = {
      theme: "theme-duo",
      fontSize: "font-normal",
      soundEnabled: true,
      ttsEnabled: true,
      ttsRate: 1.0,
      unlimitedHearts: false,
      autoSpeech: true
    };
    if (!raw) return defaults;
    try { return { ...defaults, ...JSON.parse(raw) }; } catch (e) { return defaults; }
  }

  static saveSettings(settings) {
    localStorage.setItem(this.KEY_SETTINGS, JSON.stringify(settings));
  }

  static getStats() {
    const raw = localStorage.getItem(this.KEY_STATS);
    const defaults = {
      xp: 0,
      streak: 1,
      lastDate: new Date().toDateString(),
      hearts: 5,
      maxHearts: 5,
      level: 1,
      learnedCount: 0
    };
    if (!raw) return defaults;
    try {
      const stats = { ...defaults, ...JSON.parse(raw) };
      // Streak calculation
      const today = new Date().toDateString();
      if (stats.lastDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (stats.lastDate === yesterday) {
          stats.streak += 1;
        } else {
          stats.streak = 1;
        }
        stats.lastDate = today;
        stats.hearts = stats.maxHearts;
        localStorage.setItem(this.KEY_STATS, JSON.stringify(stats));
      }
      return stats;
    } catch (e) { return defaults; }
  }

  static saveStats(stats) {
    localStorage.setItem(this.KEY_STATS, JSON.stringify(stats));
  }

  static loadAllDecks() {
    // 1. Build Built-in Decks
    const builtIn = [];

    // Add BFW Catalog topics
    const bfwCatalog = window.BFW_CATALOG || [];
    for (const cat of bfwCatalog) {
      builtIn.push({
        id: "bfw_" + cat.id,
        title: `${cat.level}: ${cat.title}`,
        subtitle: cat.subtitle,
        icon: cat.icon || "💼",
        desc: cat.desc,
        level: cat.level,
        lang: "en-US",
        sourceType: "BFW",
        words: (cat.words || []).map((w, idx) => ({
          id: `w_bfw_${cat.id}_${idx}`,
          source: w.back,      // Deutsch
          target: w.front,     // Englisch
          note: cat.subtitle,
          box: 1
        }))
      });
    }

    // Add Starter Decks
    builtIn.push({
      id: "deck_en_starter",
      title: "Englisch: Grundwortschatz & Alltag",
      subtitle: "Starter Paket",
      icon: "🌟",
      desc: "Die 15 wichtigsten englischen Basisbegriffe",
      level: "A1",
      lang: "en-US",
      sourceType: "Standard",
      words: [
        { id: "s1", source: "der Hund", target: "dog", note: "Tier", box: 1 },
        { id: "s2", source: "die Katze", target: "cat", note: "Tier", box: 1 },
        { id: "s3", source: "das Haus", target: "house", note: "Gebäude", box: 1 },
        { id: "s4", source: "der Baum", target: "tree", note: "Natur", box: 1 },
        { id: "s5", source: "das Wasser", target: "water", note: "Getränk", box: 1 },
        { id: "s6", source: "das Brot", target: "bread", note: "Essen", box: 1 },
        { id: "s7", source: "das Buch", target: "book", note: "Gegenstand", box: 1 },
        { id: "s8", source: "die Schule", target: "school", note: "Ort", box: 1 },
        { id: "s9", source: "der Freund", target: "friend", note: "Mensch", box: 1 },
        { id: "s10", source: "das Auto", target: "car", note: "Fahrzeug", box: 1 },
        { id: "s11", source: "die Sonne", target: "sun", note: "Natur", box: 1 },
        { id: "s12", source: "der Mond", target: "moon", note: "Natur", box: 1 },
        { id: "s13", source: "glücklich", target: "happy", note: "Gefühl", box: 1 },
        { id: "s14", source: "schnell", target: "fast", note: "Eigenschaft", box: 1 },
        { id: "s15", source: "lernen", target: "learn", note: "Verb", box: 1 }
      ]
    });

    // Custom user decks
    const rawCustom = localStorage.getItem(this.KEY_DECKS);
    let custom = [];
    if (rawCustom) {
      try { custom = JSON.parse(rawCustom); } catch (e) {}
    }

    return [...builtIn, ...custom];
  }

  static saveCustomDeck(deck) {
    const raw = localStorage.getItem(this.KEY_DECKS);
    let custom = [];
    if (raw) {
      try { custom = JSON.parse(raw); } catch (e) {}
    }
    const idx = custom.findIndex(d => d.id === deck.id);
    if (idx >= 0) {
      custom[idx] = deck;
    } else {
      custom.push(deck);
    }
    localStorage.setItem(this.KEY_DECKS, JSON.stringify(custom));
  }
}

// ==========================================
// 4. AUTO-UPDATE FETCHER (GITHUB CLOUD SYNC)
// ==========================================
class AutoUpdateSystem {
  static BFW_RAW_URL = "https://raw.githubusercontent.com/Lauju1909/BFW-Wirtschaftsenglisch-Android/main/www/bfw_catalog.json";
  static VERSION_URL = "version.json";

  static async checkForUpdates() {
    const statusEl = document.getElementById("update-status-text");
    const banner = document.getElementById("update-banner");

    try {
      if (statusEl) statusEl.textContent = "Prüfe auf neue Vokabeln & Updates auf GitHub...";
      const cacheBuster = "?t=" + Date.now();
      const resp = await fetch(this.BFW_RAW_URL + cacheBuster, { cache: "no-store" });
      
      if (resp.ok) {
        const onlineCatalog = await resp.json();
        if (Array.isArray(onlineCatalog) && onlineCatalog.length > 0) {
          const currentCount = (window.BFW_CATALOG || []).reduce((acc, cat) => acc + (cat.words?.length || 0), 0);
          const onlineCount = onlineCatalog.reduce((acc, cat) => acc + (cat.words?.length || 0), 0);

          if (onlineCount > currentCount || onlineCatalog.length > (window.BFW_CATALOG || []).length) {
            window.BFW_CATALOG = onlineCatalog;
            localStorage.setItem(DataManager.KEY_BFW_UPDATE, JSON.stringify(onlineCatalog));
            if (statusEl) {
              statusEl.textContent = `🎉 Neue Vokabeln gefunden! ${onlineCount} Vokabeln aktualisiert.`;
            }
            if (banner) banner.style.display = "flex";
            portalApp.renderTopics();
            return;
          }
        }
      }

      if (statusEl) {
        statusEl.textContent = "✅ Alle Vokabellisten & App-Daten sind auf dem neuesten Stand!";
      }
    } catch (e) {
      console.warn("Auto-update check offline / rate limit:", e);
      if (statusEl) {
        statusEl.textContent = "Offline-Modus aktiv: Lokale Vokabellisten sind voll einsatzbereit.";
      }
    }
  }
}

// ==========================================
// 5. MAIN PORTAL APP
// ==========================================
class PortalApp {
  constructor() {
    this.settings = DataManager.getSettings();
    this.stats = DataManager.getStats();
    this.decks = [];
    this.activeDeck = null;
    
    // Trainer States
    this.currentMode = "topics"; // "topics", "star", "meister", "import", "settings"
    this.starSession = null;
    this.meisterSession = null;
  }

  init() {
    this.applySettings();
    this.updateStatsUI();
    this.loadCachedBFW();
    this.decks = DataManager.loadAllDecks();
    this.activeDeck = this.decks[0] || null;

    this.renderTopics();
    this.setupEventListeners();

    // Check for online updates automatically after 1 second
    setTimeout(() => {
      AutoUpdateSystem.checkForUpdates();
    }, 1000);
  }

  loadCachedBFW() {
    const cached = localStorage.getItem(DataManager.KEY_BFW_UPDATE);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          window.BFW_CATALOG = parsed;
        }
      } catch (e) {}
    }
  }

  applySettings() {
    document.body.className = `${this.settings.theme} ${this.settings.fontSize}`;
    sounds.enabled = this.settings.soundEnabled;
    tts.enabled = this.settings.ttsEnabled;
    tts.rate = this.settings.ttsRate;
  }

  updateStatsUI() {
    const elStreak = document.getElementById("stat-streak");
    const elXP = document.getElementById("stat-xp");
    const elHearts = document.getElementById("stat-hearts");

    if (elStreak) elStreak.textContent = this.stats.streak;
    if (elXP) elXP.textContent = this.stats.xp;
    if (elHearts) {
      elHearts.textContent = this.settings.unlimitedHearts ? "∞" : this.stats.hearts;
    }
  }

  announceScreenreader(msg, assertive = false) {
    const el = document.getElementById(assertive ? "sr-assertive" : "sr-polite");
    if (el) {
      el.textContent = "";
      setTimeout(() => { el.textContent = msg; }, 50);
    }
  }

  switchTab(tabId) {
    sounds.click();
    this.currentMode = tabId;

    document.querySelectorAll(".nav-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });

    document.querySelectorAll(".tab-pane").forEach(pane => {
      pane.classList.toggle("active", pane.id === `pane-${tabId}`);
    });

    if (tabId === "star" && !this.starSession) {
      this.startVokabelStar();
    } else if (tabId === "meister" && !this.meisterSession) {
      this.startVokabelMeister();
    }
  }

  // ----------------------------------------------------
  // THEMEN-BIBLIOTHEK (BFW & DECK WAHL)
  // ----------------------------------------------------
  renderTopics() {
    this.decks = DataManager.loadAllDecks();
    const grid = document.getElementById("topics-grid");
    if (!grid) return;

    grid.innerHTML = "";

    this.decks.forEach(deck => {
      const card = document.createElement("article");
      card.className = "topic-card";
      card.setAttribute("role", "region");
      card.setAttribute("aria-label", deck.title);

      const wordCount = deck.words ? deck.words.length : 0;

      card.innerHTML = `
        <div class="topic-header">
          <span class="topic-icon" aria-hidden="true">${deck.icon || "📚"}</span>
          <div>
            <span class="topic-tag">${deck.sourceType || "Thema"} • ${deck.level || ""}</span>
            <h3 class="topic-title">${deck.title}</h3>
            ${deck.subtitle ? `<div style="font-size: 0.85rem; color: var(--text-muted);">${deck.subtitle}</div>` : ""}
          </div>
        </div>
        <p style="font-size: 0.9rem; color: var(--text-secondary);">${deck.desc || ""}</p>
        <div style="font-weight: 700; font-size: 0.9rem; color: var(--primary);">
          ${wordCount} Vokabeln
        </div>
        <div class="topic-actions">
          <button class="btn btn-primary btn-sm btn-start-star" data-id="${deck.id}" aria-label="${deck.title} mit VokabelStar Duolingo-Trainer starten">
            🦉 VokabelStar
          </button>
          <button class="btn btn-secondary btn-sm btn-start-meister" data-id="${deck.id}" aria-label="${deck.title} mit VokabelMeister schriftlich trainieren">
            ✍️ VokabelMeister
          </button>
        </div>
      `;

      grid.appendChild(card);
    });

    // Attach listeners
    grid.querySelectorAll(".btn-start-star").forEach(btn => {
      btn.addEventListener("click", () => {
        const deck = this.decks.find(d => d.id === btn.dataset.id);
        if (deck) {
          this.activeDeck = deck;
          this.startVokabelStar();
          this.switchTab("star");
        }
      });
    });

    grid.querySelectorAll(".btn-start-meister").forEach(btn => {
      btn.addEventListener("click", () => {
        const deck = this.decks.find(d => d.id === btn.dataset.id);
        if (deck) {
          this.activeDeck = deck;
          this.startVokabelMeister();
          this.switchTab("meister");
        }
      });
    });
  }

  // ----------------------------------------------------
  // VOKABELSTAR ENGINE (DUOLINGO STYLE)
  // ----------------------------------------------------
  startVokabelStar() {
    if (!this.activeDeck || !this.activeDeck.words || this.activeDeck.words.length === 0) {
      alert("Bitte wähle zuerst ein Thema aus der Bibliothek!");
      this.switchTab("topics");
      return;
    }

    const words = [...this.activeDeck.words].sort(() => Math.random() - 0.5);
    this.starSession = {
      deck: this.activeDeck,
      words: words,
      index: 0,
      correctCount: 0,
      total: Math.min(words.length, 12),
      currentExercise: null
    };

    const titleEl = document.getElementById("star-deck-title");
    if (titleEl) titleEl.textContent = this.activeDeck.title;

    this.renderStarExercise();
  }

  renderStarExercise() {
    const s = this.starSession;
    if (!s) return;

    if (s.index >= s.total) {
      this.finishStarSession();
      return;
    }

    // Update Progress
    const fill = document.getElementById("star-progress-fill");
    if (fill) fill.style.width = `${(s.index / s.total) * 100}%`;

    const word = s.words[s.index];
    const types = ["mc", "pair", "flashcard"];
    const chosenType = s.index % 2 === 0 ? "mc" : (s.index % 3 === 0 ? "pair" : "flashcard");

    const container = document.getElementById("star-exercise-area");
    if (!container) return;

    container.innerHTML = "";
    document.getElementById("star-feedback").style.display = "none";
    document.getElementById("star-btn-next").style.display = "none";

    if (chosenType === "mc") {
      this.renderStarMultipleChoice(container, word);
    } else if (chosenType === "pair") {
      this.renderStarPairMatching(container);
    } else {
      this.renderStarFlashcard(container, word);
    }

    if (this.settings.autoSpeech) {
      tts.speak(word.target, s.deck.lang || "en-US");
    }
  }

  renderStarMultipleChoice(container, word) {
    const s = this.starSession;
    const allTargets = s.deck.words.map(w => w.target).filter(t => t !== word.target);
    const shuffledWrong = allTargets.sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [word.target, ...shuffledWrong].sort(() => Math.random() - 0.5);

    this.announceScreenreader(`Frage ${s.index + 1} von ${s.total}: Wie heißt „${word.source}“ auf Englisch?`);

    container.innerHTML = `
      <div class="exercise-prompt">
        <div class="exercise-instruction">Wähle die richtige Übersetzung:</div>
        <div class="exercise-word">${word.source}</div>
        <button class="btn btn-outline btn-sm" id="star-tts-btn" style="margin-top: 10px;" aria-label="Aussprache anhören">
          🔊 Vorlesen
        </button>
      </div>
      <div class="mc-grid" role="group" aria-label="Antwortmöglichkeiten">
        ${options.map((opt, i) => `
          <button class="mc-option" data-ans="${opt}" aria-label="Option ${i + 1}: ${opt}">
            <span aria-hidden="true" style="margin-right: 10px; font-weight: 900; color: var(--text-muted);">${i + 1}.</span>
            ${opt}
          </button>
        `).join("")}
      </div>
    `;

    container.querySelector("#star-tts-btn").addEventListener("click", () => {
      tts.speak(word.target, s.deck.lang || "en-US");
    });

    container.querySelectorAll(".mc-option").forEach(btn => {
      btn.addEventListener("click", () => {
        this.checkStarMC(btn.dataset.ans, word.target);
      });
    });
  }

  checkStarMC(selected, correct) {
    const isCorrect = selected === correct;
    const feedback = document.getElementById("star-feedback");
    const nextBtn = document.getElementById("star-btn-next");

    document.querySelectorAll(".mc-option").forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.ans === correct) {
        btn.classList.add("correct");
      } else if (btn.dataset.ans === selected && !isCorrect) {
        btn.classList.add("wrong");
      }
    });

    if (isCorrect) {
      sounds.correct();
      this.stats.xp += 10;
      this.starSession.correctCount++;
      feedback.className = "feedback-box correct";
      feedback.textContent = "🎉 Richtig! Großartig gemacht! (+10 XP)";
      this.announceScreenreader("Richtig! 10 Erfahrungspunkte erhalten.", true);
    } else {
      sounds.wrong();
      if (!this.settings.unlimitedHearts) {
        this.stats.hearts = Math.max(0, this.stats.hearts - 1);
      }
      feedback.className = "feedback-box wrong";
      feedback.textContent = `❌ Nicht ganz! Richtige Antwort: „${correct}“`;
      this.announceScreenreader(`Falsch. Die richtige Antwort ist ${correct}.`, true);
    }

    DataManager.saveStats(this.stats);
    this.updateStatsUI();

    feedback.style.display = "flex";
    nextBtn.style.display = "inline-flex";
    nextBtn.focus();
  }

  renderStarPairMatching(container) {
    const s = this.starSession;
    const subWords = s.words.slice(s.index, s.index + 4);
    if (subWords.length < 2) {
      this.starSession.index++;
      this.renderStarExercise();
      return;
    }

    this.announceScreenreader("Übung: Finde die passenden Paare durch Antippen.");

    let cards = [];
    subWords.forEach(w => {
      cards.push({ id: w.id, text: w.source, type: "source" });
      cards.push({ id: w.id, text: w.target, type: "target" });
    });
    cards = cards.sort(() => Math.random() - 0.5);

    container.innerHTML = `
      <div class="exercise-prompt">
        <div class="exercise-instruction">Tippe die passenden Wortpaare an:</div>
      </div>
      <div class="pair-grid" role="group" aria-label="Wortpaare">
        ${cards.map((c, i) => `
          <button class="pair-card" data-id="${c.id}" data-type="${c.type}" aria-label="${c.text}">
            ${c.text}
          </button>
        `).join("")}
      </div>
    `;

    let firstSelected = null;
    let matchesFound = 0;

    container.querySelectorAll(".pair-card").forEach(btn => {
      btn.addEventListener("click", () => {
        sounds.click();
        if (btn.classList.contains("matched")) return;

        if (!firstSelected) {
          firstSelected = btn;
          btn.classList.add("selected");
          if (btn.dataset.type === "target") {
            tts.speak(btn.textContent.trim(), s.deck.lang || "en-US");
          }
        } else if (firstSelected === btn) {
          firstSelected.classList.remove("selected");
          firstSelected = null;
        } else {
          // Check pair match
          if (firstSelected.dataset.id === btn.dataset.id && firstSelected.dataset.type !== btn.dataset.type) {
            sounds.correct();
            firstSelected.classList.remove("selected");
            firstSelected.classList.add("matched");
            btn.classList.add("matched");
            firstSelected = null;
            matchesFound++;

            if (matchesFound >= subWords.length) {
              this.stats.xp += 15;
              this.starSession.correctCount += subWords.length;
              DataManager.saveStats(this.stats);
              this.updateStatsUI();

              const feedback = document.getElementById("star-feedback");
              feedback.className = "feedback-box correct";
              feedback.textContent = "🌟 Alle Paare gefunden! (+15 XP)";
              feedback.style.display = "flex";
              document.getElementById("star-btn-next").style.display = "inline-flex";
              document.getElementById("star-btn-next").focus();
            }
          } else {
            sounds.wrong();
            firstSelected.classList.remove("selected");
            firstSelected = null;
          }
        }
      });
    });
  }

  renderStarFlashcard(container, word) {
    const s = this.starSession;
    let flipped = false;

    this.announceScreenreader(`Karteikarte: ${word.source}. Zum Wenden aktivieren.`);

    container.innerHTML = `
      <div class="exercise-prompt">
        <div class="exercise-instruction">Karteikarte (Tippen zum Wenden):</div>
      </div>
      <div class="flashcard" id="active-flashcard" tabindex="0" role="button" aria-label="Karteikarte: ${word.source}. Klicke zum Aufdecken der Übersetzung.">
        <div style="font-size: 0.9rem; color: var(--text-muted); font-weight: 700;" id="fc-label">DEUTSCH</div>
        <div class="exercise-word" id="fc-text" style="margin: 20px 0;">${word.source}</div>
        <div style="font-size: 0.85rem; color: var(--primary); font-weight: 700;">🔄 Tippen zum Umdrehen</div>
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button class="btn btn-outline" id="fc-know" aria-label="Ich wusste diese Vokabel">
          ✅ Gewusst (+5 XP)
        </button>
        <button class="btn btn-outline" id="fc-repeat" aria-label="Vokabel noch einmal wiederholen">
          🔁 Noch üben
        </button>
      </div>
    `;

    const cardEl = container.querySelector("#active-flashcard");
    const labelEl = container.querySelector("#fc-label");
    const textEl = container.querySelector("#fc-text");

    const flip = () => {
      sounds.click();
      flipped = !flipped;
      if (flipped) {
        labelEl.textContent = "ENGLISCH";
        textEl.textContent = word.target;
        tts.speak(word.target, s.deck.lang || "en-US");
        this.announceScreenreader(`Übersetzung: ${word.target}`);
      } else {
        labelEl.textContent = "DEUTSCH";
        textEl.textContent = word.source;
      }
    };

    cardEl.addEventListener("click", flip);
    cardEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip();
      }
    });

    container.querySelector("#fc-know").addEventListener("click", () => {
      sounds.correct();
      this.stats.xp += 5;
      this.starSession.correctCount++;
      DataManager.saveStats(this.stats);
      this.updateStatsUI();
      this.starSession.index++;
      this.renderStarExercise();
    });

    container.querySelector("#fc-repeat").addEventListener("click", () => {
      sounds.almost();
      this.starSession.words.push(word);
      this.starSession.index++;
      this.renderStarExercise();
    });
  }

  finishStarSession() {
    sounds.levelUp();
    const container = document.getElementById("star-exercise-area");
    document.getElementById("star-feedback").style.display = "none";
    document.getElementById("star-btn-next").style.display = "none";

    const s = this.starSession;
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 4rem; line-height: 1; margin-bottom: 12px;">🏆</div>
        <h2 style="font-size: var(--font-size-hero); font-weight: 900; margin-bottom: 8px;">Lektion abgeschlossen!</h2>
        <p style="font-size: var(--font-size-lg); color: var(--text-secondary); margin-bottom: 24px;">
          Du hast <strong>${s.correctCount}</strong> von <strong>${s.total}</strong> Übungen gemeistert!
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-primary" id="btn-star-again">🔄 Nochmal üben</button>
          <button class="btn btn-secondary" id="btn-star-to-meister">✍️ Jetzt schriftlich im VokabelMeister</button>
          <button class="btn btn-outline" id="btn-star-to-topics">📚 Andere Lektion wählen</button>
        </div>
      </div>
    `;

    this.announceScreenreader("Herzlichen Glückwunsch! Lektion erfolgreich abgeschlossen.", true);

    document.getElementById("btn-star-again").addEventListener("click", () => {
      this.startVokabelStar();
    });
    document.getElementById("btn-star-to-meister").addEventListener("click", () => {
      this.startVokabelMeister();
      this.switchTab("meister");
    });
    document.getElementById("btn-star-to-topics").addEventListener("click", () => {
      this.switchTab("topics");
    });
  }

  // ----------------------------------------------------
  // VOKABELMEISTER ENGINE (SCHRIFTLICHE ABFRAGE)
  // ----------------------------------------------------
  startVokabelMeister() {
    if (!this.activeDeck || !this.activeDeck.words || this.activeDeck.words.length === 0) {
      alert("Bitte wähle zuerst ein Thema aus der Bibliothek!");
      this.switchTab("topics");
      return;
    }

    const words = [...this.activeDeck.words].sort(() => Math.random() - 0.5);
    this.meisterSession = {
      deck: this.activeDeck,
      words: words,
      index: 0,
      total: Math.min(words.length, 15),
      correct: 0,
      almost: 0,
      wrong: 0
    };

    const titleEl = document.getElementById("meister-deck-title");
    if (titleEl) titleEl.textContent = this.activeDeck.title;

    this.renderMeisterExercise();
  }

  renderMeisterExercise() {
    const s = this.meisterSession;
    if (!s) return;

    if (s.index >= s.total) {
      this.finishMeisterSession();
      return;
    }

    // Update Progress
    const fill = document.getElementById("meister-progress-fill");
    if (fill) fill.style.width = `${(s.index / s.total) * 100}%`;

    const word = s.words[s.index];
    const container = document.getElementById("meister-exercise-area");
    const feedback = document.getElementById("meister-feedback");
    const nextBtn = document.getElementById("meister-btn-next");

    feedback.style.display = "none";
    nextBtn.style.display = "none";

    this.announceScreenreader(`Vokabel ${s.index + 1} von ${s.total}: Wie lautet die englische Übersetzung von ${word.source}? Bitte eingeben.`);

    container.innerHTML = `
      <div class="exercise-prompt">
        <div class="exercise-instruction">Wie lautet die Übersetzung für:</div>
        <div class="exercise-word">${word.source}</div>
        ${word.note ? `<div style="font-size: 0.9rem; color: var(--text-muted); font-weight: 600; margin-top: 6px;">Hinweis: ${word.note}</div>` : ""}
      </div>
      <form id="meister-form" class="meister-input-group" autocomplete="off">
        <label for="meister-answer-input" class="sr-only">Englische Übersetzung eingeben</label>
        <input type="text" id="meister-answer-input" class="meister-input" placeholder="Hier tippen..." autofocus required>
        <div style="display: flex; gap: 12px; margin-top: 14px;">
          <button type="submit" class="btn btn-primary" style="flex: 1;" id="btn-meister-submit">
            Antwort prüfen (Enter)
          </button>
          <button type="button" class="btn btn-outline" id="btn-meister-tts" aria-label="Begriff anhören">
            🔊 Vorlesen
          </button>
        </div>
      </form>
    `;

    const input = container.querySelector("#meister-answer-input");
    input.focus();

    container.querySelector("#btn-meister-tts").addEventListener("click", () => {
      tts.speak(word.target, s.deck.lang || "en-US");
    });

    container.querySelector("#meister-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.checkMeisterAnswer(input.value, word.target);
    });
  }

  checkMeisterAnswer(userInput, expected) {
    const res = verifyAnswerFuzzy(userInput, expected);
    const feedback = document.getElementById("meister-feedback");
    const nextBtn = document.getElementById("meister-btn-next");
    const submitBtn = document.getElementById("btn-meister-submit");
    const input = document.getElementById("meister-answer-input");

    if (submitBtn) submitBtn.disabled = true;
    if (input) input.disabled = true;

    if (res.status === "correct") {
      sounds.correct();
      this.stats.xp += 10;
      this.meisterSession.correct++;
      feedback.className = "feedback-box correct";
      feedback.textContent = `✅ ${res.message} (+10 XP)`;
      this.announceScreenreader(res.message, true);
    } else if (res.status === "almost") {
      sounds.almost();
      this.stats.xp += 5;
      this.meisterSession.almost++;
      feedback.className = "feedback-box almost";
      feedback.textContent = `⚠️ ${res.message} (+5 XP)`;
      this.announceScreenreader(res.message, true);
    } else {
      sounds.wrong();
      this.meisterSession.wrong++;
      feedback.className = "feedback-box wrong";
      feedback.textContent = `❌ ${res.message}`;
      this.announceScreenreader(res.message, true);
    }

    DataManager.saveStats(this.stats);
    this.updateStatsUI();

    feedback.style.display = "flex";
    nextBtn.style.display = "inline-flex";
    nextBtn.focus();

    // Pronounce the correct English term
    if (this.settings.autoSpeech) {
      tts.speak(expected, this.meisterSession.deck.lang || "en-US");
    }
  }

  finishMeisterSession() {
    sounds.levelUp();
    const container = document.getElementById("meister-exercise-area");
    document.getElementById("meister-feedback").style.display = "none";
    document.getElementById("meister-btn-next").style.display = "none";

    const s = this.meisterSession;
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 4rem; line-height: 1; margin-bottom: 12px;">🎖️</div>
        <h2 style="font-size: var(--font-size-hero); font-weight: 900; margin-bottom: 8px;">Schreibtraining beendet!</h2>
        <p style="font-size: var(--font-size-lg); color: var(--text-secondary); margin-bottom: 24px;">
          Ergebnis: <strong>${s.correct}</strong> exakt richtig, <strong>${s.almost}</strong> mit kleinen Tippfehlern, <strong>${s.wrong}</strong> falsch.
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-primary" id="btn-meister-again">🔄 Nochmal schreiben</button>
          <button class="btn btn-secondary" id="btn-meister-to-star">🦉 Zu VokabelStar (Duolingo-Modus)</button>
          <button class="btn btn-outline" id="btn-meister-to-topics">📚 Andere Lektion wählen</button>
        </div>
      </div>
    `;

    this.announceScreenreader("Herzlichen Glückwunsch! Schreibtraining erfolgreich abgeschlossen.", true);

    document.getElementById("btn-meister-again").addEventListener("click", () => {
      this.startVokabelMeister();
    });
    document.getElementById("btn-meister-to-star").addEventListener("click", () => {
      this.startVokabelStar();
      this.switchTab("star");
    });
    document.getElementById("btn-meister-to-topics").addEventListener("click", () => {
      this.switchTab("topics");
    });
  }

  // ----------------------------------------------------
  // UNIVERSAL-IMPORT & EXPORT
  // ----------------------------------------------------
  setupImportExport() {
    const fileInput = document.getElementById("import-file-input");
    const importBtn = document.getElementById("btn-run-import");
    const exportBtn = document.getElementById("btn-export-backup");

    if (importBtn && fileInput) {
      importBtn.addEventListener("click", () => {
        const file = fileInput.files[0];
        if (!file) {
          alert("Bitte wähle zuerst eine Datei (.docx, .xlsx, .csv, .txt, .json) aus!");
          return;
        }

        const ext = file.name.split(".").pop().toLowerCase();
        const reader = new FileReader();

        if (ext === "json" || ext === "txt" || ext === "csv") {
          reader.onload = (e) => {
            this.parseTextImport(e.target.result, file.name, ext);
          };
          reader.readAsText(file, "utf-8");
        } else if (ext === "xlsx" || ext === "xls") {
          reader.onload = (e) => {
            this.parseExcelImport(e.target.result, file.name);
          };
          reader.readAsArrayBuffer(file);
        } else if (ext === "docx") {
          reader.onload = (e) => {
            this.parseWordImport(e.target.result, file.name);
          };
          reader.readAsArrayBuffer(file);
        } else {
          alert("Nicht unterstütztes Format. Bitte nutze Word, Excel, CSV, TXT oder JSON.");
        }
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const backup = {
          exportDate: new Date().toISOString(),
          stats: this.stats,
          customDecks: DataManager.loadAllDecks().filter(d => d.sourceType !== "BFW")
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `VokabelPortal_Backup_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  parseTextImport(content, filename, ext) {
    let words = [];
    if (ext === "json") {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          words = parsed.map((item, idx) => ({
            id: `w_imp_${Date.now()}_${idx}`,
            source: item.source || item.de || item.back || item.front,
            target: item.target || item.en || item.front || item.back,
            note: item.note || item.kategorie || "",
            box: 1
          }));
        }
      } catch (e) {
        alert("Fehlerhafte JSON-Datei!");
        return;
      }
    } else {
      // CSV or TXT line by line
      const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
      lines.forEach((line, idx) => {
        const parts = line.split(/[;\t,]/).map(p => p.trim());
        if (parts.length >= 2) {
          words.push({
            id: `w_imp_${Date.now()}_${idx}`,
            source: parts[0],
            target: parts[1],
            note: parts[2] || "",
            box: 1
          });
        }
      });
    }

    if (words.length > 0) {
      this.createImportedDeck(filename.replace(/\.[^/.]+$/, ""), words);
    } else {
      alert("Es konnten keine Vokabeln aus der Datei gelesen werden.");
    }
  }

  parseExcelImport(buffer, filename) {
    if (!window.XLSX) {
      alert("Excel-Parser noch nicht geladen. Bitte Seite neu laden.");
      return;
    }
    try {
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const words = [];

      rows.forEach((row, idx) => {
        if (Array.isArray(row) && row.length >= 2) {
          const col1 = String(row[0] || "").trim();
          const col2 = String(row[1] || "").trim();
          if (col1 && col2) {
            words.push({
              id: `w_xl_${Date.now()}_${idx}`,
              source: col1,
              target: col2,
              note: String(row[2] || "").trim(),
              box: 1
            });
          }
        }
      });

      if (words.length > 0) {
        this.createImportedDeck(filename.replace(/\.[^/.]+$/, ""), words);
      } else {
        alert("Keine gültigen Vokabelzeilen in der Excel-Tabelle gefunden.");
      }
    } catch (e) {
      alert("Fehler beim Lesen der Excel-Datei: " + e.message);
    }
  }

  parseWordImport(buffer, filename) {
    if (!window.mammoth) {
      alert("Word-Parser noch nicht geladen. Bitte Seite neu laden.");
      return;
    }
    mammoth.extractRawText({ arrayBuffer: buffer })
      .then(res => {
        this.parseTextImport(res.value, filename, "txt");
      })
      .catch(e => {
        alert("Fehler beim Lesen der Word-Datei: " + e.message);
      });
  }

  createImportedDeck(title, words) {
    sounds.correct();
    const newDeck = {
      id: "deck_custom_" + Date.now(),
      title: title,
      subtitle: "Eigene Importierte Liste",
      icon: "📥",
      desc: `Importiert am ${new Date().toLocaleDateString()}`,
      sourceType: "Eigene Liste",
      lang: "en-US",
      words: words
    };

    DataManager.saveCustomDeck(newDeck);
    alert(`🎉 Erfolgreich importiert: ${words.length} Vokabeln als neues Thema angelegt!`);
    this.renderTopics();
    this.switchTab("topics");
  }

  // ----------------------------------------------------
  // EVENT LISTENERS & SETUP
  // ----------------------------------------------------
  setupEventListeners() {
    // Navigation Tabs
    document.querySelectorAll(".nav-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // Star Next Button
    const starNext = document.getElementById("star-btn-next");
    if (starNext) {
      starNext.addEventListener("click", () => {
        if (this.starSession) {
          this.starSession.index++;
          this.renderStarExercise();
        }
      });
    }

    // Meister Next Button
    const meisterNext = document.getElementById("meister-btn-next");
    if (meisterNext) {
      meisterNext.addEventListener("click", () => {
        if (this.meisterSession) {
          this.meisterSession.index++;
          this.renderMeisterExercise();
        }
      });
    }

    // Manual Update Trigger
    const btnCheckUpdate = document.getElementById("btn-check-updates-manual");
    if (btnCheckUpdate) {
      btnCheckUpdate.addEventListener("click", () => {
        sounds.click();
        AutoUpdateSystem.checkForUpdates();
      });
    }

    // Settings Form
    const themeSel = document.getElementById("setting-theme");
    const fontSel = document.getElementById("setting-font");
    const soundChk = document.getElementById("setting-sound");
    const ttsChk = document.getElementById("setting-tts");
    const heartsChk = document.getElementById("setting-unlimited-hearts");

    if (themeSel) {
      themeSel.value = this.settings.theme;
      themeSel.addEventListener("change", (e) => {
        this.settings.theme = e.target.value;
        this.applySettings();
        DataManager.saveSettings(this.settings);
      });
    }

    if (fontSel) {
      fontSel.value = this.settings.fontSize;
      fontSel.addEventListener("change", (e) => {
        this.settings.fontSize = e.target.value;
        this.applySettings();
        DataManager.saveSettings(this.settings);
      });
    }

    if (soundChk) {
      soundChk.checked = this.settings.soundEnabled;
      soundChk.addEventListener("change", (e) => {
        this.settings.soundEnabled = e.target.checked;
        sounds.enabled = e.target.checked;
        DataManager.saveSettings(this.settings);
      });
    }

    if (ttsChk) {
      ttsChk.checked = this.settings.ttsEnabled;
      ttsChk.addEventListener("change", (e) => {
        this.settings.ttsEnabled = e.target.checked;
        tts.enabled = e.target.checked;
        DataManager.saveSettings(this.settings);
      });
    }

    if (heartsChk) {
      heartsChk.checked = this.settings.unlimitedHearts;
      heartsChk.addEventListener("change", (e) => {
        this.settings.unlimitedHearts = e.target.checked;
        this.updateStatsUI();
        DataManager.saveSettings(this.settings);
      });
    }

    this.setupImportExport();
  }
}

// Global initialization
let portalApp = null;
window.addEventListener("DOMContentLoaded", () => {
  portalApp = new PortalApp();
  portalApp.init();
});
