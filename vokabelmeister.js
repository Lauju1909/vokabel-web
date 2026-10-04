/**
 * app.js – VokabelMeister Barrierefreier Schriftlicher Vokabeltrainer
 * Exakte Portierung des Python-Backends (Damerau-Levenshtein, Klammer-/Slash-Expansion,
 * gewichteter Lernalgorithmus, TalkBack-Barrierefreiheit & Speech-Synthese).
 */

// ── Standard-Kategorien (identisch zu Python backend.py) ──────────────────────
const DEFAULT_KATEGORIEN = {
  "Sprache": {
    icon: "🌍",
    beschreibung: "Fremdwörter und Übersetzungen",
    frage_front: "Wie lautet die Übersetzung von:",
    frage_back: "In welcher Sprache heißt der Begriff:",
    lbl_front: "Fremdsprache",
    lbl_back: "Zielsprache"
  },
  "Fachwörter": {
    icon: "📚",
    beschreibung: "Fachbegriffe und ihre Bedeutung",
    frage_front: "Was bedeutet der Begriff:",
    frage_back: "Welcher Begriff beschreibt folgendes:",
    lbl_front: "Fachbegriff",
    lbl_back: "Bedeutung"
  },
  "Formeln": {
    icon: "🔬",
    beschreibung: "Formeln und ihre Anwendung",
    frage_front: "Erkläre die Formel:",
    frage_back: "Welche Formel beschreibt folgendes:",
    lbl_front: "Formel",
    lbl_back: "Beschreibung"
  },
  "Befehle": {
    icon: "💻",
    beschreibung: "Tastenkürzel und was sie machen",
    frage_front: "Was macht das Tastenkürzel:",
    frage_back: "Welches Tastenkürzel macht folgendes:",
    lbl_front: "Tastenkürzel",
    lbl_back: "Was sie machen"
  }
};

const STOPWORDS = new Set([
  "der", "die", "das", "ein", "eine", "einer", "eines", "einem", "einen",
  "the", "a", "an", "to", "of", "in", "on", "at", "by", "for", "with", "mit",
  "und", "and", "or", "oder", "sich", "zu", "von", "aus", "den", "dem", "des"
]);

// ── Damerau-Levenshtein Algorithmus & Toleranz ────────────────────────────────
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
        d[i + 1][j] + 1,        // insertion
        d[i][j] + cost          // substitution
      );
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        d[i + 1][j + 1] = Math.min(d[i + 1][j + 1], d[i - 1][j - 1] + 1); // transposition
      }
    }
  }
  return d[len1 + 1][len2 + 1];
}

function maxAllowedTypos(wordLen) {
  if (wordLen <= 3) return 0;
  if (wordLen <= 7) return 1;
  return 2;
}

function cleanMatchingStr(s) {
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
    const content = m[1];
    const start = m.index;
    const end = start + m[0].length;

    const optA = curr.substring(0, start) + content + curr.substring(end);
    const optB = curr.substring(0, start) + curr.substring(end);

    const res = new Set([...recurse(optA), ...recurse(optB)]);
    if (content.includes("-")) {
      const optC = curr.substring(0, start) + content.replace(/-/g, "") + curr.substring(end);
      recurse(optC).forEach(item => res.add(item));
    }
    return res;
  }

  const rawRes = recurse(text);
  const out = new Set();
  rawRes.forEach(r => {
    const cleaned = r.trim().replace(/\s+/g, " ");
    if (cleaned) out.add(cleaned);
  });
  return out;
}

function expandSlashForms(text) {
  const forms = new Set([text]);

  const mIn = text.match(/(\w+)\/in\b/i);
  if (mIn) {
    const base = mIn[1];
    forms.add(text.substring(0, mIn.index) + base + text.substring(mIn.index + mIn[0].length));
    forms.add(text.substring(0, mIn.index) + base + "in" + text.substring(mIn.index + mIn[0].length));
  }

  const mE = text.match(/(\w+)\/e\b/i);
  if (mE) {
    const base = mE[1];
    forms.add(text.substring(0, mE.index) + base + text.substring(mE.index + mE[0].length));
    forms.add(text.substring(0, mE.index) + base + "e" + text.substring(mE.index + mE[0].length));
  }

  const mRs = text.match(/(\w+)\/r\/s\b/i);
  if (mRs) {
    const base = mRs[1];
    forms.add(text.substring(0, mRs.index) + base + text.substring(mRs.index + mRs[0].length));
    forms.add(text.substring(0, mRs.index) + base + "r" + text.substring(mRs.index + mRs[0].length));
    forms.add(text.substring(0, mRs.index) + base + "s" + text.substring(mRs.index + mRs[0].length));
  }

  const mR = text.match(/(\w+)\/r\b/i);
  if (mR) {
    const base = mR[1];
    forms.add(text.substring(0, mR.index) + base + text.substring(mR.index + mR[0].length));
    forms.add(text.substring(0, mR.index) + base + "r" + text.substring(mR.index + mR[0].length));
  }

  if (text.includes("/") && !mIn && !mE && !mRs && !mR) {
    forms.add(text.replace(/\//g, " "));
    text.split("/").forEach(w => {
      const wStr = w.trim();
      if (wStr.length >= 2 || ["a", "i", "o", "u"].includes(wStr)) {
        forms.add(wStr);
      }
    });
  }

  const cleanForms = new Set();
  forms.forEach(f => {
    const trimmed = f.trim();
    if (trimmed) cleanForms.add(trimmed);
  });
  return cleanForms;
}

function getAnswerCandidates(expected) {
  const raw = expected.toLowerCase().trim();
  const fullForms = new Set();
  const parts = new Set();
  const allWords = new Set();

  const bracketVariants = expandBrackets(raw);

  bracketVariants.forEach(bv => {
    expandSlashForms(bv).forEach(sf => {
      const c = cleanMatchingStr(sf);
      if (c) {
        fullForms.add(c);
        parts.add(c);
        c.split(" ").forEach(w => allWords.add(w));
      }
    });

    const subItems = bv.split(/[,;]+|\s+-\s+|\boder\b|\bor\b/);
    subItems.forEach(item => {
      expandSlashForms(item).forEach(sf => {
        const c = cleanMatchingStr(sf);
        if (c) {
          parts.add(c);
          c.split(" ").forEach(w => allWords.add(w));
        }
      });
      if (item.includes("/")) {
        item.split("/").forEach(slashP => {
          const c = cleanMatchingStr(slashP);
          if (c) {
            parts.add(c);
            c.split(" ").forEach(w => allWords.add(w));
          }
        });
      }
    });
  });

  return {
    fullForms: Array.from(fullForms),
    parts: Array.from(parts),
    allWords: Array.from(allWords)
  };
}

function checkAnswer(userInput, expected, allowTypos = true) {
  const uClean = cleanMatchingStr(userInput);
  if (!uClean) return { isCorrect: false, isTypo: false };

  const { fullForms, parts, allWords } = getAnswerCandidates(expected);
  const uWords = uClean.split(" ");

  // 1. Exakte Übereinstimmung mit Vollform oder Teil
  if (fullForms.includes(uClean) || parts.includes(uClean)) {
    return { isCorrect: true, isTypo: false };
  }

  // 2. Ein einzelnes Wort von mehreren reicht (außer reine Stoppwörter)
  if (uWords.length === 1 && allWords.includes(uWords[0])) {
    if (!STOPWORDS.has(uWords[0])) {
      return { isCorrect: true, isTypo: false };
    }
  }

  // 3. Beliebige Wortreihenfolge und Teilmengen
  if (uWords.length >= 1) {
    const combined = [...fullForms, ...parts];
    for (const p of combined) {
      const pWords = p.split(" ");
      if (pWords.length > 1) {
        const uSet = new Set(uWords);
        const pSet = new Set(pWords);
        if (uWords.length === pWords.length && [...uSet].every(w => pSet.has(w))) {
          return { isCorrect: true, isTypo: false };
        }
        if (uWords.length > 1 && [...uSet].every(w => pSet.has(w))) {
          if (uWords.some(w => !STOPWORDS.has(w))) {
            return { isCorrect: true, isTypo: false };
          }
        }
      }
    }
  }

  if (!allowTypos) {
    return { isCorrect: false, isTypo: false };
  }

  // 4. Tippfehler-Erkennung (Fuzzy Matching mit Damerau-Levenshtein)
  const combined = [...fullForms, ...parts];
  for (const target of combined) {
    if (!target) continue;
    const limit = maxAllowedTypos(target.length);
    if (limit > 0 && damerauLevenshtein(uClean, target) <= limit) {
      return { isCorrect: true, isTypo: true };
    }
  }

  if (uWords.length === 1) {
    const w = uWords[0];
    for (const tw of allWords) {
      if (STOPWORDS.has(tw)) continue;
      const limit = maxAllowedTypos(tw.length);
      if (limit > 0 && damerauLevenshtein(w, tw) <= limit) {
        return { isCorrect: true, isTypo: true };
      }
    }
  }

  if (uWords.length > 1) {
    for (const p of combined) {
      const pWords = p.split(" ");
      if (pWords.length === uWords.length) {
        const usedIndices = new Set();
        let matchedAll = true;
        for (const uw of uWords) {
          let found = false;
          for (let idx = 0; idx < pWords.length; idx++) {
            if (usedIndices.has(idx)) continue;
            const lim = maxAllowedTypos(pWords[idx].length);
            if (damerauLevenshtein(uw, pWords[idx]) <= lim) {
              usedIndices.add(idx);
              found = true;
              break;
            }
          }
          if (!found) {
            matchedAll = false;
            break;
          }
        }
        if (matchedAll) {
          return { isCorrect: true, isTypo: true };
        }
      }
    }
  }

  return { isCorrect: false, isTypo: false };
}

function getMotivation(score) {
  if (score < 20) return { text: "Kopf hoch – du schaffst das! 💪", color: "#e05c5c" };
  if (score < 40) return { text: "Nicht aufgeben, weiter üben! 📖", color: "#f0a500" };
  if (score < 60) return { text: "Du wirst besser, bleib dran! 🙂", color: "#f0a500" };
  if (score < 80) return { text: "Gut gemacht, weiter so! 👍", color: "#4caf7d" };
  if (score < 95) return { text: "Super – fast perfekt! ⭐", color: "#4caf7d" };
  return { text: "Ausgezeichnet – mach weiter so! 🏆", color: "#7986e0" };
}

// ── Vokabel-Klasse ────────────────────────────────────────────────────────────
class Vokabel {
  constructor(front, back, kategorie = "Sprache", langFront = "Englisch", langBack = "Deutsch", attempts = 0, correct = 0) {
    this.front = front.trim();
    this.back = back.trim();
    this.kategorie = kategorie.trim() || "Sprache";
    this.lang_front = (langFront || "Englisch").trim();
    this.lang_back = (langBack || "Deutsch").trim();
    this.attempts = Number(attempts) || 0;
    this.correct = Number(correct) || 0;
  }

  get score() {
    if (this.attempts === 0) return 0;
    return Math.round((this.correct / this.attempts) * 100);
  }

  get weight() {
    return (100.0 - this.score) + 10.0;
  }
}

// ── State & Storage Manager ──────────────────────────────────────────────────
class VokabelApp {
  constructor() {
    this.kategorien = { ...DEFAULT_KATEGORIEN };
    this.vokabeln = [];
    this.currentCard = null;
    this.currentDir = "standard"; // "standard" (front->back), "reverse" (back->front)
    this.sessionCorrect = 0;
    this.sessionAttempts = 0;
    this.lastCard = null;
    this.currentPage = 1;
    this.pageSize = 25;

    this.settings = {
      direction: "standard",
      tts: false,
      ttsSpeed: 1.0,
      typoTolerance: true,
      highContrast: false,
      fontSize: "normal"
    };

    this.init();
  }

  async init() {
    this.loadSettings();
    this.applySettings();
    await this.loadData();
    this.bindEvents();
    this.renderKategorien();
    this.updateCategoryDropdowns();
    this.renderVocabTable();
    this.nextCard();
  }

  announce(msg) {
    const el = document.getElementById("sr-announcer");
    if (el) {
      el.textContent = "";
      setTimeout(() => { el.textContent = msg; }, 50);
    }
  }

  speak(text, lang) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.settings.ttsSpeed;

    const l = (lang || "").toLowerCase();
    if (l.includes("engl") || l === "en") {
      utterance.lang = "en-US";
    } else if (l.includes("franz") || l === "fr") {
      utterance.lang = "fr-FR";
    } else if (l.includes("span") || l === "es") {
      utterance.lang = "es-ES";
    } else if (l.includes("ital") || l === "it") {
      utterance.lang = "it-IT";
    } else {
      utterance.lang = "de-DE";
    }
    window.speechSynthesis.speak(utterance);
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem("vokabelmeister_settings");
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn("Could not load settings:", e);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem("vokabelmeister_settings", JSON.stringify(this.settings));
    } catch (e) {
      console.warn("Could not save settings:", e);
    }
  }

  applySettings() {
    document.body.classList.toggle("high-contrast", this.settings.highContrast);
    document.body.classList.toggle("font-large", this.settings.fontSize === "large");
    document.body.classList.toggle("font-xlarge", this.settings.fontSize === "xlarge");

    const selDir = document.getElementById("setting-direction");
    if (selDir) selDir.value = this.settings.direction;

    const chkTts = document.getElementById("setting-tts");
    if (chkTts) chkTts.checked = this.settings.tts;

    const selSpeed = document.getElementById("setting-tts-speed");
    if (selSpeed) selSpeed.value = String(this.settings.ttsSpeed);

    const chkTypo = document.getElementById("setting-typo-tolerance");
    if (chkTypo) chkTypo.checked = this.settings.typoTolerance;

    const chkContrast = document.getElementById("setting-high-contrast");
    if (chkContrast) chkContrast.checked = this.settings.highContrast;

    const selFont = document.getElementById("setting-font-size");
    if (selFont) selFont.value = this.settings.fontSize;
  }

  async loadData() {
    // 1. Kategorien
    try {
      const savedKats = localStorage.getItem("vokabelmeister_kategorien");
      if (savedKats) {
        this.kategorien = { ...DEFAULT_KATEGORIEN, ...JSON.parse(savedKats) };
      }
    } catch (e) {
      console.warn("Error loading kategorien:", e);
    }

    // 2. Vokabeln
    try {
      const savedVocabs = localStorage.getItem("vokabelmeister_vokabeln");
      if (savedVocabs) {
        const raw = JSON.parse(savedVocabs);
        if (Array.isArray(raw) && raw.length > 0) {
          this.vokabeln = raw.map(d => new Vokabel(d.front, d.back, d.kategorie, d.lang_front, d.lang_back, d.attempts, d.correct));
          return;
        }
      }
    } catch (e) {
      console.warn("Error loading local storage vocabs:", e);
    }

    // Falls noch nichts gespeichert war, lade initial vokabeln.json
    try {
      const res = await fetch("vokabeln.json");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          this.vokabeln = data.map(d => new Vokabel(d.front, d.back, d.kategorie, d.lang_front, d.lang_back, d.attempts, d.correct));
          this.saveData();
          return;
        }
      }
    } catch (e) {
      console.warn("Error loading bundled vokabeln.json:", e);
    }

    // Fallback falls Datei nicht lesbar
    this.vokabeln = [
      new Vokabel("apple", "Apfel", "Sprache", "Englisch", "Deutsch"),
      new Vokabel("house", "Haus", "Sprache", "Englisch", "Deutsch"),
      new Vokabel("Photosynthese", "Pflanzen erzeugen mit Licht Zucker", "Fachwörter"),
      new Vokabel("E = mc²", "Masse-Energie-Äquivalenz (Einstein)", "Formeln"),
      new Vokabel("Windows + D", "Desktop anzeigen", "Befehle")
    ];
    this.saveData();
  }

  saveData() {
    try {
      localStorage.setItem("vokabelmeister_vokabeln", JSON.stringify(this.vokabeln));
      const customKats = {};
      for (const [k, v] of Object.entries(this.kategorien)) {
        if (!DEFAULT_KATEGORIEN[k]) {
          customKats[k] = v;
        }
      }
      localStorage.setItem("vokabelmeister_kategorien", JSON.stringify(customKats));
    } catch (e) {
      console.error("Save error:", e);
    }
    this.updateStatsCounters();
  }

  updateStatsCounters() {
    const totalCountEl = document.getElementById("total-count-badge");
    if (totalCountEl) totalCountEl.textContent = this.vokabeln.length;

    const sessionCounter = document.getElementById("session-counter");
    if (sessionCounter) sessionCounter.textContent = this.sessionAttempts;

    const sessionAcc = document.getElementById("session-accuracy");
    if (sessionAcc) {
      if (this.sessionAttempts === 0) {
        sessionAcc.textContent = "--%";
      } else {
        sessionAcc.textContent = `${Math.round((this.sessionCorrect / this.sessionAttempts) * 100)}%`;
      }
    }
  }

  getFilteredPool() {
    const filterEl = document.getElementById("quick-cat-select");
    const selectedCat = filterEl ? filterEl.value : "ALL";
    if (selectedCat === "ALL") {
      return this.vokabeln;
    }
    return this.vokabeln.filter(v => v.kategorie === selectedCat);
  }

  nextCard() {
    const pool = this.getFilteredPool();
    if (pool.length === 0) {
      document.getElementById("question-term").textContent = "Keine Vokabeln in dieser Kategorie";
      document.getElementById("question-prompt").textContent = "Bitte wähle eine andere Kategorie oder füge Vokabeln hinzu.";
      document.getElementById("current-cat-badge").textContent = "Leer";
      document.getElementById("current-dir-badge").textContent = "--";
      document.getElementById("answer-input").disabled = true;
      document.getElementById("btn-submit-answer").disabled = true;
      return;
    }

    document.getElementById("answer-input").disabled = false;
    document.getElementById("btn-submit-answer").disabled = false;

    // Filter out streak repetition if pool > 1
    let candidates = pool;
    if (pool.length > 1 && this.lastCard) {
      const filtered = pool.filter(v => v !== this.lastCard);
      if (filtered.length > 0) candidates = filtered;
    }

    // Weighted random selection
    const totalWeight = candidates.reduce((sum, v) => sum + v.weight, 0);
    let rand = Math.random() * totalWeight;
    let chosen = candidates[0];

    for (const v of candidates) {
      if (rand < v.weight) {
        chosen = v;
        break;
      }
      rand -= v.weight;
    }

    this.currentCard = chosen;
    this.lastCard = chosen;

    // Direction calculation
    if (this.settings.direction === "reverse") {
      this.currentDir = "reverse";
    } else if (this.settings.direction === "random") {
      this.currentDir = Math.random() > 0.5 ? "standard" : "reverse";
    } else {
      this.currentDir = "standard";
    }

    const katInfo = this.kategorien[chosen.kategorie] || DEFAULT_KATEGORIEN["Sprache"];
    const isStandard = this.currentDir === "standard";

    const promptText = isStandard ? (katInfo.frage_front || "Wie lautet die Übersetzung von:") : (katInfo.frage_back || "Welcher Begriff beschreibt folgendes:");
    const termText = isStandard ? chosen.front : chosen.back;
    const langInfo = isStandard ? `${chosen.lang_front} ➔ ${chosen.lang_back}` : `${chosen.lang_back} ➔ ${chosen.lang_front}`;

    document.getElementById("current-cat-badge").textContent = `${katInfo.icon || "🏷️"} ${chosen.kategorie}`;
    document.getElementById("current-dir-badge").textContent = isStandard ? "Standard (A ➔ B)" : "Umgekehrt (B ➔ A)";
    document.getElementById("current-weight-badge").textContent = `Quote: ${chosen.score}% (${chosen.correct}/${chosen.attempts})`;
    document.getElementById("question-prompt").textContent = promptText;
    document.getElementById("question-term").textContent = termText;
    document.getElementById("question-lang-info").textContent = langInfo;

    // Reset Input & Feedback
    const inputEl = document.getElementById("answer-input");
    inputEl.value = "";
    document.getElementById("btn-clear-input").style.display = "none";
    document.getElementById("feedback-panel").style.display = "none";

    // Focus input field automatically
    inputEl.focus();

    // Screen reader announcement
    const announcement = `${promptText} ${termText}. ${langInfo}. Bitte Antwort eingeben.`;
    this.announce(announcement);

    // Auto-TTS if enabled
    if (this.settings.tts) {
      const speakLang = isStandard ? chosen.lang_front : chosen.lang_back;
      this.speak(termText, speakLang);
    }
  }

  submitAnswer() {
    if (!this.currentCard) return;

    const inputEl = document.getElementById("answer-input");
    const userInput = inputEl.value.trim();
    if (!userInput) {
      inputEl.focus();
      return;
    }

    const isStandard = this.currentDir === "standard";
    const expected = isStandard ? this.currentCard.back : this.currentCard.front;

    const { isCorrect, isTypo } = checkAnswer(userInput, expected, this.settings.typoTolerance);

    // Update stats
    this.sessionAttempts++;
    this.currentCard.attempts++;
    if (isCorrect) {
      this.sessionCorrect++;
      this.currentCard.correct++;
    }
    this.saveData();

    // Show feedback panel
    const feedbackPanel = document.getElementById("feedback-panel");
    const feedbackIcon = document.getElementById("feedback-icon");
    const feedbackTitle = document.getElementById("feedback-title");
    const feedbackExpected = document.getElementById("feedback-expected");
    const feedbackUser = document.getElementById("feedback-user");
    const rowUser = document.getElementById("row-user-answer");
    const motivBanner = document.getElementById("motivation-banner");
    const statsText = document.getElementById("vocab-stats-text");

    feedbackPanel.style.display = "flex";
    feedbackExpected.textContent = expected;

    if (isCorrect && !isTypo) {
      feedbackIcon.textContent = "✅";
      feedbackTitle.textContent = "Richtig!";
      feedbackTitle.style.color = "#4caf7d";
      rowUser.style.display = "none";
    } else if (isCorrect && isTypo) {
      feedbackIcon.textContent = "⚠️";
      feedbackTitle.textContent = "Fast richtig (Tippfehler)!";
      feedbackTitle.style.color = "#f0a500";
      rowUser.style.display = "flex";
      feedbackUser.textContent = userInput;
    } else {
      feedbackIcon.textContent = "❌";
      feedbackTitle.textContent = "Leider falsch!";
      feedbackTitle.style.color = "#e05c5c";
      rowUser.style.display = "flex";
      feedbackUser.textContent = userInput;
    }

    const motiv = getMotivation(this.currentCard.score);
    motivBanner.textContent = motiv.text;
    motivBanner.style.color = motiv.color;

    statsText.textContent = `${this.currentCard.score}% (${this.currentCard.correct} von ${this.currentCard.attempts} richtig)`;

    // Announce feedback to screen readers
    const srMsg = `${feedbackTitle.textContent}. Erwartete Antwort: ${expected}. ${motiv.text}`;
    this.announce(srMsg);

    // Focus "Nächste Vokabel" button
    document.getElementById("btn-next-card").focus();
  }

  bindEvents() {
    // Tab Switching
    document.querySelectorAll(".nav-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".nav-tab").forEach(t => {
          t.classList.remove("active");
          t.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        const panelId = tab.getAttribute("data-tab");
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add("active");

        if (panelId === "tab-train") {
          setTimeout(() => document.getElementById("answer-input").focus(), 100);
        } else if (panelId === "tab-vokabeln") {
          this.renderVocabTable();
        }
      });
    });

    // Answering
    const inputEl = document.getElementById("answer-input");
    const clearBtn = document.getElementById("btn-clear-input");

    inputEl.addEventListener("input", () => {
      clearBtn.style.display = inputEl.value.length > 0 ? "flex" : "none";
    });

    clearBtn.addEventListener("click", () => {
      inputEl.value = "";
      clearBtn.style.display = "none";
      inputEl.focus();
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submitAnswer();
      }
    });

    document.getElementById("btn-submit-answer").addEventListener("click", () => {
      this.submitAnswer();
    });

    document.getElementById("btn-skip-answer").addEventListener("click", () => {
      this.nextCard();
    });

    // Next Card Button
    document.getElementById("btn-next-card").addEventListener("click", () => {
      this.nextCard();
    });

    // Global Key Listener for Quick Advancing
    document.addEventListener("keydown", (e) => {
      const feedbackPanel = document.getElementById("feedback-panel");
      if (feedbackPanel && feedbackPanel.style.display !== "none") {
        if (e.key === "Enter" || e.key === " ") {
          // If focus is not on a specific other button
          if (document.activeElement?.id !== "btn-speak-answer") {
            e.preventDefault();
            this.nextCard();
          }
        }
      }
    });

    // TTS Speak Buttons
    document.getElementById("btn-speak-question").addEventListener("click", () => {
      if (!this.currentCard) return;
      const isStandard = this.currentDir === "standard";
      const text = isStandard ? this.currentCard.front : this.currentCard.back;
      const lang = isStandard ? this.currentCard.lang_front : this.currentCard.lang_back;
      this.speak(text, lang);
    });

    document.getElementById("btn-speak-answer").addEventListener("click", () => {
      if (!this.currentCard) return;
      const isStandard = this.currentDir === "standard";
      const text = isStandard ? this.currentCard.back : this.currentCard.front;
      const lang = isStandard ? this.currentCard.lang_back : this.currentCard.lang_front;
      this.speak(text, lang);
    });

    // Quick Category Selector
    document.getElementById("quick-cat-select").addEventListener("change", () => {
      this.nextCard();
    });

    // New Category Form
    document.getElementById("form-new-cat").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("new-cat-name").value.trim();
      const icon = document.getElementById("new-cat-icon").value.trim() || "🏷️";
      const desc = document.getElementById("new-cat-desc").value.trim();
      const front = document.getElementById("new-cat-frage-front").value.trim() || "Wie lautet die Übersetzung von:";
      const back = document.getElementById("new-cat-frage-back").value.trim() || "Welcher Begriff beschreibt folgendes:";

      if (!name || this.kategorien[name]) {
        alert("Kategoriename existiert bereits oder ist ungültig.");
        return;
      }

      this.kategorien[name] = {
        icon,
        beschreibung: desc,
        frage_front: front,
        frage_back: back,
        lbl_front: "Vorderseite",
        lbl_back: "Rückseite"
      };

      this.saveData();
      this.renderKategorien();
      this.updateCategoryDropdowns();
      document.getElementById("form-new-cat").reset();
      this.announce(`Kategorie ${name} wurde erstellt.`);
    });

    // Vocab Table Search & Filter
    document.getElementById("vocab-search-input").addEventListener("input", () => {
      this.currentPage = 1;
      this.renderVocabTable();
    });

    document.getElementById("vocab-filter-cat").addEventListener("change", () => {
      this.currentPage = 1;
      this.renderVocabTable();
    });

    // Add Vocab UI
    document.getElementById("btn-open-add-vocab").addEventListener("click", () => {
      const box = document.getElementById("add-vocab-box");
      box.style.display = box.style.display === "none" ? "block" : "none";
      if (box.style.display === "block") {
        document.getElementById("form-add-vocab").reset();
        document.getElementById("edit-vocab-idx").value = "-1";
        document.getElementById("add-vocab-title").textContent = "Neue Vokabel hinzufügen";
        document.getElementById("vocab-input-front").focus();
      }
    });

    document.getElementById("btn-cancel-add-vocab").addEventListener("click", () => {
      document.getElementById("add-vocab-box").style.display = "none";
    });

    document.getElementById("form-add-vocab").addEventListener("submit", (e) => {
      e.preventDefault();
      const idx = parseInt(document.getElementById("edit-vocab-idx").value, 10);
      const cat = document.getElementById("vocab-input-cat").value;
      const front = document.getElementById("vocab-input-front").value.trim();
      const back = document.getElementById("vocab-input-back").value.trim();
      const langFront = document.getElementById("vocab-input-lang-front").value.trim();
      const langBack = document.getElementById("vocab-input-lang-back").value.trim();

      if (!front || !back) return;

      if (idx >= 0 && idx < this.vokabeln.length) {
        // Edit
        const v = this.vokabeln[idx];
        v.front = front;
        v.back = back;
        v.kategorie = cat;
        v.lang_front = langFront;
        v.lang_back = langBack;
      } else {
        // Add
        this.vokabeln.push(new Vokabel(front, back, cat, langFront, langBack));
      }

      this.saveData();
      this.renderVocabTable();
      document.getElementById("add-vocab-box").style.display = "none";
      this.announce(`Vokabel ${front} gespeichert.`);
    });

    // Pagination
    document.getElementById("btn-page-prev").addEventListener("click", () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderVocabTable();
      }
    });
    document.getElementById("btn-page-next").addEventListener("click", () => {
      this.currentPage++;
      this.renderVocabTable();
    });

    // Settings Listeners
    document.getElementById("setting-direction").addEventListener("change", (e) => {
      this.settings.direction = e.target.value;
      this.saveSettings();
      this.nextCard();
    });

    document.getElementById("setting-tts").addEventListener("change", (e) => {
      this.settings.tts = e.target.checked;
      this.saveSettings();
    });

    document.getElementById("setting-tts-speed").addEventListener("change", (e) => {
      this.settings.ttsSpeed = parseFloat(e.target.value);
      this.saveSettings();
    });

    document.getElementById("setting-typo-tolerance").addEventListener("change", (e) => {
      this.settings.typoTolerance = e.target.checked;
      this.saveSettings();
    });

    document.getElementById("setting-high-contrast").addEventListener("change", (e) => {
      this.settings.highContrast = e.target.checked;
      this.applySettings();
      this.saveSettings();
    });

    document.getElementById("setting-font-size").addEventListener("change", (e) => {
      this.settings.fontSize = e.target.value;
      this.applySettings();
      this.saveSettings();
    });

    // Import / Export
    document.getElementById("file-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this.handleFileImport(file);
    });

    document.getElementById("btn-export-json").addEventListener("click", () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.vokabeln, null, 2));
      const a = document.createElement("a");
      a.href = dataStr;
      a.download = `VokabelMeister_Export_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    });

    document.getElementById("btn-export-txt").addEventListener("click", () => {
      const lines = this.vokabeln.map(v => `${v.front} | ${v.back}`);
      const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(lines.join("\n"));
      const a = document.createElement("a");
      a.href = dataStr;
      a.download = `VokabelMeister_Liste_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
    });

    document.getElementById("btn-reset-stats").addEventListener("click", () => {
      if (confirm("Möchtest du wirklich alle Lernstatistiken (Abfragen und Erfolgsquoten) auf 0 zurücksetzen?")) {
        this.vokabeln.forEach(v => {
          v.attempts = 0;
          v.correct = 0;
        });
        this.sessionAttempts = 0;
        this.sessionCorrect = 0;
        this.saveData();
        this.renderVocabTable();
        alert("Lernstatistiken wurden erfolgreich zurückgesetzt.");
      }
    });

    document.getElementById("btn-reset-all").addEventListener("click", () => {
      if (confirm("WARNUNG: Dadurch werden alle Vokabeln gelöscht und der Standard wiederhergestellt. Fortfahren?")) {
        localStorage.removeItem("vokabelmeister_vokabeln");
        localStorage.removeItem("vokabelmeister_kategorien");
        location.reload();
      }
    });
  }

  updateCategoryDropdowns() {
    const selects = ["quick-cat-select", "vocab-filter-cat", "vocab-input-cat", "import-target-cat"];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const val = el.value;
      el.innerHTML = "";

      if (id === "quick-cat-select") {
        el.innerHTML = `<option value="ALL">🌟 Alle Kategorien zusammen üben</option>`;
      } else if (id === "vocab-filter-cat") {
        el.innerHTML = `<option value="ALL">Alle Kategorien</option>`;
      }

      for (const [k, v] of Object.entries(this.kategorien)) {
        const count = this.vokabeln.filter(voc => voc.kategorie === k).length;
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = `${v.icon || "🏷️"} ${k} (${count})`;
        el.appendChild(opt);
      }

      if (val && Array.from(el.options).some(o => o.value === val)) {
        el.value = val;
      }
    });
  }

  renderKategorien() {
    const list = document.getElementById("kategorien-list");
    if (!list) return;
    list.innerHTML = "";

    for (const [k, v] of Object.entries(this.kategorien)) {
      const count = this.vokabeln.filter(voc => voc.kategorie === k).length;
      const isCustom = !DEFAULT_KATEGORIEN[k];

      const card = document.createElement("div");
      card.className = "kat-card";
      card.innerHTML = `
        <div class="kat-header">
          <span class="kat-icon" aria-hidden="true">${v.icon || "🏷️"}</span>
          <span class="kat-title">${k}</span>
          <span class="kat-count">${count} Begriffe</span>
        </div>
        <div class="kat-desc">${v.beschreibung || "Keine Beschreibung"}</div>
        <div class="kat-actions">
          <button type="button" class="btn btn-secondary btn-small" data-kat="${k}">
            <span>🎯 Diese Kategorie üben</span>
          </button>
          ${isCustom ? `<button type="button" class="btn btn-danger btn-small" data-del-kat="${k}">Löschen</button>` : ""}
        </div>
      `;

      card.querySelector("[data-kat]").addEventListener("click", () => {
        const sel = document.getElementById("quick-cat-select");
        if (sel) sel.value = k;
        document.getElementById("btn-tab-train").click();
        this.nextCard();
      });

      if (isCustom) {
        card.querySelector("[data-del-kat]").addEventListener("click", () => {
          if (confirm(`Kategorie '${k}' und alle enthaltenen Vokabeln wirklich löschen?`)) {
            delete this.kategorien[k];
            this.vokabeln = this.vokabeln.filter(voc => voc.kategorie !== k);
            this.saveData();
            this.renderKategorien();
            this.updateCategoryDropdowns();
            this.renderVocabTable();
          }
        });
      }

      list.appendChild(card);
    }
  }

  renderVocabTable() {
    const searchVal = (document.getElementById("vocab-search-input").value || "").toLowerCase().trim();
    const filterCat = document.getElementById("vocab-filter-cat").value;

    let filtered = this.vokabeln.filter(v => {
      if (filterCat !== "ALL" && v.kategorie !== filterCat) return false;
      if (searchVal) {
        return v.front.toLowerCase().includes(searchVal) || v.back.toLowerCase().includes(searchVal);
      }
      return true;
    });

    const summaryEl = document.getElementById("vocab-table-summary");
    summaryEl.textContent = `${filtered.length} Vokabeln gefunden`;

    const totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    if (this.currentPage > totalPages) this.currentPage = totalPages;

    document.getElementById("pagination-info").textContent = `Seite ${this.currentPage} von ${totalPages}`;
    document.getElementById("btn-page-prev").disabled = this.currentPage <= 1;
    document.getElementById("btn-page-next").disabled = this.currentPage >= totalPages;

    const start = (this.currentPage - 1) * this.pageSize;
    const pageItems = filtered.slice(start, start + this.pageSize);

    const tbody = document.getElementById("vocab-tbody");
    tbody.innerHTML = "";

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">Keine Einträge gefunden.</td></tr>`;
      return;
    }

    pageItems.forEach(v => {
      const idx = this.vokabeln.indexOf(v);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${v.front}</strong></td>
        <td>${v.back}</td>
        <td><span class="badge category-badge">${v.kategorie}</span></td>
        <td>${v.score}% <small>(${v.correct}/${v.attempts})</small></td>
        <td>
          <button type="button" class="btn btn-secondary btn-small" data-edit="${idx}" title="Bearbeiten">✏️</button>
          <button type="button" class="btn btn-danger btn-small" data-del="${idx}" title="Löschen">🗑️</button>
        </td>
      `;

      tr.querySelector("[data-edit]").addEventListener("click", () => {
        const box = document.getElementById("add-vocab-box");
        box.style.display = "block";
        document.getElementById("edit-vocab-idx").value = idx;
        document.getElementById("add-vocab-title").textContent = "Vokabel bearbeiten";
        document.getElementById("vocab-input-cat").value = v.kategorie;
        document.getElementById("vocab-input-front").value = v.front;
        document.getElementById("vocab-input-back").value = v.back;
        document.getElementById("vocab-input-lang-front").value = v.lang_front;
        document.getElementById("vocab-input-lang-back").value = v.lang_back;
        document.getElementById("vocab-input-front").focus();
      });

      tr.querySelector("[data-del]").addEventListener("click", () => {
        if (confirm(`'${v.front}' wirklich löschen?`)) {
          this.vokabeln.splice(idx, 1);
          this.saveData();
          this.renderVocabTable();
          this.updateCategoryDropdowns();
        }
      });

      tbody.appendChild(tr);
    });
  }

  async handleFileImport(file) {
    const statusMsg = document.getElementById("import-status-msg");
    statusMsg.style.display = "block";
    statusMsg.className = "status-msg";
    statusMsg.textContent = "Importiere Datei …";

    const targetCat = document.getElementById("import-target-cat").value || "Sprache";
    const ext = file.name.split(".").pop().toLowerCase();

    try {
      let pairs = [];

      if (ext === "json") {
        const text = await file.text();
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          let count = 0;
          data.forEach(d => {
            if (d.front && d.back) {
              this.vokabeln.push(new Vokabel(d.front, d.back, d.kategorie || targetCat, d.lang_front, d.lang_back, d.attempts, d.correct));
              count++;
            }
          });
          this.saveData();
          this.renderVocabTable();
          this.updateCategoryDropdowns();
          statusMsg.className = "status-msg success";
          statusMsg.textContent = `Erfolg: ${count} Vokabeln aus JSON importiert!`;
          return;
        }
      } else if (ext === "docx") {
        if (window.mammoth) {
          const arrayBuffer = await file.arrayBuffer();
          const result = await window.mammoth.extractRawText({ arrayBuffer });
          const lines = result.value.split("\n");
          lines.forEach(l => {
            const pair = this.splitLine(l);
            if (pair) pairs.push(pair);
          });
        }
      } else if (["xlsx", "xls", "csv"].includes(ext)) {
        if (window.XLSX) {
          const data = await file.arrayBuffer();
          const workbook = window.XLSX.read(data);
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonRows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
          jsonRows.forEach(row => {
            if (row.length >= 2 && row[0] && row[1]) {
              const a = String(row[0]).trim();
              const b = String(row[1]).trim();
              if (a.toLowerCase() !== "vorderseite" && a.toLowerCase() !== "front") {
                pairs.push([a, b]);
              }
            }
          });
        }
      } else {
        // Plain text
        const text = await file.text();
        text.split("\n").forEach(l => {
          const pair = this.splitLine(l);
          if (pair) pairs.push(pair);
        });
      }

      if (pairs.length === 0) {
        statusMsg.className = "status-msg error";
        statusMsg.textContent = "Keine gültigen Vokabelpaare in der Datei gefunden.";
        return;
      }

      let added = 0;
      let dupes = 0;
      pairs.forEach(([front, back]) => {
        const exists = this.vokabeln.some(v => v.front.toLowerCase() === front.toLowerCase() && v.kategorie === targetCat);
        if (!exists) {
          this.vokabeln.push(new Vokabel(front, back, targetCat));
          added++;
        } else {
          dupes++;
        }
      });

      this.saveData();
      this.renderVocabTable();
      this.updateCategoryDropdowns();
      statusMsg.className = "status-msg success";
      statusMsg.textContent = `Erfolg: ${added} neue Vokabeln importiert (${dupes} Duplikate übersprungen).`;
    } catch (err) {
      statusMsg.className = "status-msg error";
      statusMsg.textContent = `Fehler beim Import: ${err.message}`;
    }
  }

  splitLine(line) {
    const l = line.trim();
    if (!l || l.startsWith("#")) return null;
    const seps = ["|", "\t", ";", "–", "—", " - ", "-"];
    for (const sep of seps) {
      if (l.includes(sep)) {
        const parts = l.split(sep);
        const a = parts[0].trim();
        const b = parts.slice(1).join(sep).trim();
        if (a && b) return [a, b];
      }
    }
    return null;
  }
}

// Start app on DOMContentLoaded
window.addEventListener("DOMContentLoaded", () => {
  window.app = new VokabelApp();
  // Auto-sync BFW topics if present
  if (window.BFW_CATALOG && Array.isArray(window.BFW_CATALOG)) {
    setTimeout(() => {
      if (window.onExternalTopicsSynced) {
        window.onExternalTopicsSynced(JSON.stringify(window.BFW_CATALOG));
      }
      const params = new URLSearchParams(window.location.search);
      const pCat = params.get("cat");
      if (pCat && window.app) {
        const catSelect = document.getElementById("select-kategorie");
        if (catSelect) {
          catSelect.value = pCat;
          catSelect.dispatchEvent(new Event("change"));
        }
      }
    }, 250);
  }
  if (window.AndroidSyncBridge && window.AndroidSyncBridge.requestSync) {
    setTimeout(() => {
      try { window.AndroidSyncBridge.requestSync(); } catch (e) {}
    }, 150);
  }
});

// Automatic cross-app sync from BFW Vokabel-Verwaltung
window.onExternalTopicsSynced = function(jsonStr) {
  try {
    const topics = JSON.parse(jsonStr);
    if (!Array.isArray(topics) || !window.app) return;

    let addedCount = 0;
    let lastCat = "";

    topics.forEach(t => {
      const cat = `BFW: ${t.title}`;
      lastCat = cat;
      (t.words || []).forEach(w => {
        const exists = window.app.vokabeln.some(v => 
          v.front.toLowerCase() === w.front.toLowerCase() && v.kategorie === cat
        );
        if (!exists) {
          window.app.vokabeln.push(new Vokabel(w.front, w.back, cat, "Englisch", "Deutsch", 0, 0));
          addedCount++;
        }
      });
    });

    if (addedCount > 0) {
      window.app.saveData();
      window.app.renderVocabTable();
      window.app.updateCategoryDropdowns();
      const msg = `🎉 ${addedCount} neue Vokabeln aus BFW Vokabel-Verwaltung synchronisiert!`;
      window.app.announce(msg);

      let toast = document.getElementById("sync-live-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "sync-live-toast";
        toast.style.cssText = "position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #5c6bc0; color: #fff; padding: 12px 20px; border-radius: 25px; font-weight: bold; z-index: 999999; box-shadow: 0 4px 15px rgba(0,0,0,0.4); text-align: center; max-width: 90%;";
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.display = "block";
      setTimeout(() => { if (toast) toast.style.display = "none"; }, 5000);
    }
  } catch (err) {
    console.warn("Sync error in VokabelMeister:", err);
  }
};
