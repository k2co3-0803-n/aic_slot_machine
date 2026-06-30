const STORAGE_KEY = "ticket-slot-draw-state-v1";
const SPIN_TICK_MS = 58;
const SPIN_SOUND_MS = 72;
const COIN_SOUND_MS = 430;
const IMPACT_EFFECT_MS = 1700;
const ANTHEM_VOLUME = 0.56;
const SFX_MASTER_GAIN = 1.55;
const DEFAULT_ANTHEM_SRC = "wakakichi.mp3";

const elements = {
  ticketInput: document.querySelector("#ticketInput"),
  rangeStart: document.querySelector("#rangeStart"),
  rangeEnd: document.querySelector("#rangeEnd"),
  addRangeButton: document.querySelector("#addRangeButton"),
  applyButton: document.querySelector("#applyButton"),
  sampleButton: document.querySelector("#sampleButton"),
  clearAllButton: document.querySelector("#clearAllButton"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  drawButton: document.querySelector("#drawButton"),
  drawButtonLabel: document.querySelector("#drawButtonLabel"),
  drawIcon: document.querySelector("#drawIcon"),
  undoButton: document.querySelector("#undoButton"),
  exportButton: document.querySelector("#exportButton"),
  winnerSummaryButton: document.querySelector("#winnerSummaryButton"),
  anthemToggleButton: document.querySelector("#anthemToggleButton"),
  anthemToggleIcon: document.querySelector("#anthemToggleIcon"),
  anthemToggleLabel: document.querySelector("#anthemToggleLabel"),
  anthemRestartButton: document.querySelector("#anthemRestartButton"),
  anthemInput: document.querySelector("#anthemInput"),
  anthemButton: document.querySelector("#anthemButton"),
  inputMessage: document.querySelector("#inputMessage"),
  slotNumber: document.querySelector("#slotNumber"),
  drawLabel: document.querySelector("#drawLabel"),
  winnerList: document.querySelector("#winnerList"),
  winnerItemTemplate: document.querySelector("#winnerItemTemplate"),
  winnerSummaryModal: document.querySelector("#winnerSummaryModal"),
  winnerSummaryCloseButton: document.querySelector("#winnerSummaryCloseButton"),
  winnerSummaryGrid: document.querySelector("#winnerSummaryGrid"),
  fxLayer: document.querySelector("#slotFxLayer"),
};

const state = {
  tickets: [],
  winners: [],
  sourceText: "",
  spinning: false,
  spinTimer: 0,
  spinSoundTimer: 0,
  coinSoundTimer: 0,
  impactTimer: 0,
  winnerShowcaseTimer: 0,
  audioContext: null,
  sfxCompressor: null,
  sfxGain: null,
  anthemAudio: null,
  anthemUrl: "",
  anthemUsingDefault: false,
  anthemManuallyStopped: false,
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.tickets) || !Array.isArray(saved.winners)) {
      return;
    }

    state.tickets = uniqueValues(saved.tickets.map(String));
    state.winners = saved.winners
      .filter((entry) => entry && typeof entry.number !== "undefined")
      .map((entry) => ({
        number: String(entry.number),
        drawnAt: entry.drawnAt || new Date().toISOString(),
      }));
    state.sourceText = typeof saved.sourceText === "string" ? saved.sourceText : state.tickets.join("\n");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tickets: state.tickets,
      winners: state.winners,
      sourceText: state.sourceText,
    }),
  );
}

function parseTicketText(value) {
  const tokens = value
    .split(/[\s,、，]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return uniqueValues(tokens);
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const normalized = String(value).trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });

  return result;
}

function sortTicketNumbers(values) {
  return [...values].sort((a, b) => {
    const aNumber = Number(a);
    const bNumber = Number(b);
    const bothNumeric = Number.isFinite(aNumber) && Number.isFinite(bNumber);

    if (bothNumeric && aNumber !== bNumber) {
      return aNumber - bNumber;
    }

    return a.localeCompare(b, "ja", { numeric: true });
  });
}

function getRemainingTickets() {
  const winnerNumbers = new Set(state.winners.map((entry) => entry.number));
  return state.tickets.filter((ticket) => !winnerNumbers.has(ticket));
}

function getRandomInt(max) {
  if (max <= 0) {
    return 0;
  }

  const cryptoObject = window.crypto || window.msCrypto;
  if (cryptoObject?.getRandomValues) {
    const array = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;
    let value = 0;

    do {
      cryptoObject.getRandomValues(array);
      value = array[0];
    } while (value >= limit);

    return value % max;
  }

  return Math.floor(Math.random() * max);
}

function chooseTicket(candidates) {
  return candidates[getRandomInt(candidates.length)];
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!state.audioContext) {
    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") {
    state.audioContext.resume();
  }

  return state.audioContext;
}

function getSfxOutput() {
  const context = getAudioContext();
  if (!context) {
    return null;
  }

  if (!state.sfxCompressor || !state.sfxGain) {
    state.sfxCompressor = context.createDynamicsCompressor();
    state.sfxCompressor.threshold.setValueAtTime(-18, context.currentTime);
    state.sfxCompressor.knee.setValueAtTime(18, context.currentTime);
    state.sfxCompressor.ratio.setValueAtTime(6, context.currentTime);
    state.sfxCompressor.attack.setValueAtTime(0.004, context.currentTime);
    state.sfxCompressor.release.setValueAtTime(0.16, context.currentTime);

    state.sfxGain = context.createGain();
    state.sfxGain.gain.setValueAtTime(SFX_MASTER_GAIN, context.currentTime);
    state.sfxCompressor.connect(state.sfxGain).connect(context.destination);
  }

  return state.sfxCompressor;
}

function playTone(frequency, duration, options = {}) {
  const context = getAudioContext();
  const output = getSfxOutput();
  if (!context || !output) {
    return;
  }

  const {
    type = "sine",
    gain = 0.04,
    delay = 0,
    slideTo = null,
    attack = 0.01,
  } = options;
  const startAt = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  if (slideTo) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), startAt + duration);
  }

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(gain, startAt + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gainNode).connect(output);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.04);
}

function playNoiseBurst(duration, gain, options = {}) {
  const context = getAudioContext();
  const output = getSfxOutput();
  if (!context || !output) {
    return;
  }

  const {
    delay = 0,
    frequency = 420,
    endFrequency = 80,
    filterType = "lowpass",
  } = options;
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < length; index += 1) {
    const fade = 1 - index / length;
    data[index] = (Math.random() * 2 - 1) * fade;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gainNode = context.createGain();
  const startAt = context.currentTime + delay;

  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, startAt);
  filter.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), startAt + duration);
  gainNode.gain.setValueAtTime(gain, startAt);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  source.buffer = buffer;
  source.connect(filter).connect(gainNode).connect(output);
  source.start(startAt);
  source.stop(startAt + duration + 0.02);
}

function playSpinStartSound() {
  [220, 329.63, 493.88, 659.25, 987.77, 1318.51].forEach((note, index) => {
    playTone(note, 0.09, {
      type: index < 2 ? "sawtooth" : "triangle",
      gain: index < 2 ? 0.05 : 0.068,
      delay: index * 0.036,
      attack: 0.004,
    });
  });
  playNoiseBurst(0.09, 0.078, {
    delay: 0.16,
    frequency: 3600,
    endFrequency: 1200,
    filterType: "highpass",
  });
  playMarchPulse(0.18, 0.9);
}

function playSpinTickSound(step = 0) {
  const notes = [659.25, 739.99, 880, 987.77, 1174.66, 987.77, 880, 739.99];
  const note = notes[step % notes.length];
  const accent = step % 8 === 0;

  playTone(note, 0.055, {
    type: "square",
    gain: accent ? 0.062 : 0.038,
    attack: 0.003,
  });
  playTone(note * 2, 0.032, {
    type: "sine",
    gain: accent ? 0.036 : 0.022,
    attack: 0.002,
  });
  playTone(1760 + (step % 3) * 220, 0.022, {
    type: "triangle",
    gain: 0.02,
    delay: 0.022,
    attack: 0.001,
  });
  playNoiseBurst(0.018, accent ? 0.048 : 0.03, {
    frequency: 4200,
    endFrequency: 2400,
    filterType: "highpass",
  });
  playMarchPulse(0, accent ? 1 : 0.66);
  if (step % 4 === 0) {
    playTone(1567.98, 0.05, {
      type: "triangle",
      gain: 0.03,
      delay: 0.018,
      attack: 0.002,
    });
  }
  if (step % 8 === 4) {
    playKeioLock(step);
  }
}

function playCoinSound() {
  [1318.51, 1760, 2093].forEach((note, index) => {
    playTone(note, 0.12, {
      type: "triangle",
      gain: 0.052,
      delay: index * 0.028,
      attack: 0.003,
    });
  });
  playNoiseBurst(0.07, 0.044, {
    delay: 0.018,
    frequency: 5200,
    endFrequency: 1600,
    filterType: "highpass",
  });
}

function playMarchPulse(delay = 0, intensity = 1) {
  playTone(110, 0.052, {
    type: "sine",
    gain: 0.034 * intensity,
    delay,
    slideTo: 72,
    attack: 0.002,
  });
  playNoiseBurst(0.026, 0.032 * intensity, {
    delay: delay + 0.006,
    frequency: 2600,
    endFrequency: 900,
    filterType: "highpass",
  });
}

function playKeioLock(step = 0) {
  const turn = step % 16 === 4 ? 1 : -1;
  const notes = turn > 0 ? [880, 1174.66, 1760] : [1174.66, 987.77, 1567.98];

  notes.forEach((note, index) => {
    playTone(note, 0.055, {
      type: "triangle",
      gain: 0.034,
      delay: index * 0.03,
      attack: 0.002,
    });
  });
}

function playRoyalFanfare() {
  const fanfare = [196, 392, 587.33, 783.99, 1174.66, 1567.98];

  fanfare.forEach((note, index) => {
    playTone(note, 0.42, {
      type: index < 2 ? "sawtooth" : "triangle",
      gain: index < 2 ? 0.058 : 0.088,
      delay: 0.08 + index * 0.058,
      attack: 0.008,
    });
  });
  [1760, 2093, 2637.02, 3135.96].forEach((note, index) => {
    playTone(note, 0.2, {
      type: "sine",
      gain: 0.042,
      delay: 0.46 + index * 0.054,
      attack: 0.004,
    });
  });
}

function playPrizeCascade() {
  const sparkleNotes = [987.77, 1174.66, 1318.51, 1567.98, 1760, 2093, 2637.02];

  [440, 493.88, 523.25].forEach((note, index) => {
    playTone(note, 0.07, {
      type: "square",
      gain: 0.066,
      delay: index * 0.055,
      attack: 0.002,
    });
    playNoiseBurst(0.026, 0.038, {
      delay: index * 0.055,
      frequency: 3800,
      endFrequency: 2100,
      filterType: "highpass",
    });
  });

  sparkleNotes.forEach((note, index) => {
    playTone(note, 0.18, {
      type: index % 2 === 0 ? "triangle" : "sine",
      gain: 0.064,
      delay: 0.18 + index * 0.052,
      attack: 0.003,
    });
    playTone(note * 1.5, 0.12, {
      type: "sine",
      gain: 0.026,
      delay: 0.2 + index * 0.052,
      attack: 0.002,
    });
  });
}

function playImpactSound({ includeFanfare = true } = {}) {
  playNoiseBurst(0.18, 0.115, {
    frequency: 4600,
    endFrequency: 1700,
    filterType: "highpass",
  });
  playPrizeCascade();
  playNoiseBurst(0.34, 0.26, {
    delay: 0.38,
    frequency: 420,
  });
  playTone(96, 0.32, {
    type: "sine",
    gain: 0.19,
    delay: 0.34,
    slideTo: 38,
    attack: 0.005,
  });
  playMarchPulse(0.42, 1.35);

  if (includeFanfare) {
    playRoyalFanfare();
  }
}

function stopAnthem({ reset = false, manual = false } = {}) {
  if (manual) {
    state.anthemManuallyStopped = true;
  }

  if (!state.anthemAudio) {
    return;
  }

  state.anthemAudio.pause();
  if (reset) {
    state.anthemAudio.currentTime = 0;
  }
}

function bindAnthemPlaybackEvents(audio) {
  ["play", "pause", "ended"].forEach((eventName) => {
    audio.addEventListener?.(eventName, renderButtons);
  });
}

function keepAnthemPlaying({ force = false } = {}) {
  if (state.anthemManuallyStopped && !force) {
    return false;
  }

  if (!state.anthemAudio) {
    return false;
  }

  if (force) {
    state.anthemManuallyStopped = false;
  }

  state.anthemAudio.volume = ANTHEM_VOLUME;
  state.anthemAudio.loop = true;

  const playPromise = state.anthemAudio.play();
  if (playPromise?.then) {
    playPromise
      .then(() => renderButtons())
      .catch(() => {
        renderButtons();
        setMessage("応援歌音源はブラウザの制限で自動再生できませんでした。応援歌音源ボタンを押すと再開できます。", true);
      });
  } else if (playPromise?.catch) {
    playPromise.catch(() => {
      renderButtons();
      setMessage("応援歌音源はブラウザの制限で自動再生できませんでした。応援歌音源ボタンを押すと再開できます。", true);
    });
  } else {
    renderButtons();
  }

  return true;
}

function startSpinAudio() {
  stopSpinAudio();
  playSpinStartSound();

  let tickStep = 0;
  state.spinSoundTimer = window.setInterval(() => {
    playSpinTickSound(tickStep);
    tickStep += 1;
  }, SPIN_SOUND_MS);
  state.coinSoundTimer = window.setInterval(playCoinSound, COIN_SOUND_MS);
}

function stopSpinAudio() {
  window.clearInterval(state.spinSoundTimer);
  window.clearInterval(state.coinSoundTimer);
  state.spinSoundTimer = 0;
  state.coinSoundTimer = 0;
}

function startSpinEffects() {
  window.clearTimeout(state.impactTimer);
  document.body.classList.remove("slot-impacting");
  elements.fxLayer.classList.remove("is-impact");
  elements.fxLayer.classList.add("is-spinning");
  startSpinAudio();
}

function finishSpinEffects() {
  stopSpinAudio();
  elements.fxLayer.classList.remove("is-spinning", "is-impact");
  document.body.classList.add("slot-impacting");
  void elements.fxLayer.offsetWidth;
  elements.fxLayer.classList.add("is-impact");
  keepAnthemPlaying();
  playImpactSound();

  window.clearTimeout(state.impactTimer);
  state.impactTimer = window.setTimeout(() => {
    elements.fxLayer.classList.remove("is-impact");
    document.body.classList.remove("slot-impacting");
  }, IMPACT_EFFECT_MS);
}

function cancelSpinEffects() {
  stopSpinAudio();
  window.clearTimeout(state.impactTimer);
  elements.fxLayer.classList.remove("is-spinning", "is-impact");
  document.body.classList.remove("slot-impacting");
}

function setAnthemAudio() {
  const [file] = elements.anthemInput.files || [];
  if (!file) {
    return;
  }

  stopAnthem({ reset: true });
  if (state.anthemUrl) {
    URL.revokeObjectURL(state.anthemUrl);
  }

  state.anthemUrl = URL.createObjectURL(file);
  state.anthemAudio = new Audio(state.anthemUrl);
  state.anthemUsingDefault = false;
  state.anthemManuallyStopped = false;
  state.anthemAudio.preload = "auto";
  state.anthemAudio.loop = true;
  state.anthemAudio.volume = ANTHEM_VOLUME;
  bindAnthemPlaybackEvents(state.anthemAudio);
  elements.anthemButton.classList.add("is-loaded");
  keepAnthemPlaying({ force: true });
  setMessage(`${file.name} を応援歌音源に設定しました。常時ループ再生します。`);
  renderButtons();
}

function loadDefaultAnthemAudio() {
  const audio = new Audio(DEFAULT_ANTHEM_SRC);

  audio.preload = "auto";
  audio.loop = true;
  audio.volume = ANTHEM_VOLUME;
  bindAnthemPlaybackEvents(audio);
  audio.addEventListener?.(
    "canplay",
    () => {
      if (state.anthemAudio === audio) {
        elements.anthemButton.classList.add("is-loaded");
      }
    },
    { once: true },
  );
  audio.addEventListener?.(
    "error",
    () => {
      if (state.anthemAudio === audio && state.anthemUsingDefault) {
        state.anthemAudio = null;
        state.anthemUsingDefault = false;
        state.anthemManuallyStopped = false;
        elements.anthemButton.classList.remove("is-loaded");
        renderButtons();
      }
    },
    { once: true },
  );

  state.anthemAudio = audio;
  state.anthemUsingDefault = true;
  state.anthemManuallyStopped = false;
}

function handleAnthemButton() {
  if (state.anthemAudio?.paused) {
    keepAnthemPlaying({ force: true });
    setMessage("応援歌を再生しました。");
    renderButtons();
    return;
  }

  elements.anthemInput.click();
}

function handleAnthemToggleButton() {
  if (!state.anthemAudio) {
    setMessage("先に応援歌音源を設定してください。", true);
    return;
  }

  if (state.anthemAudio.paused || state.anthemManuallyStopped) {
    keepAnthemPlaying({ force: true });
    state.anthemManuallyStopped = false;
    setMessage("応援歌を再生しました。");
  } else {
    stopAnthem({ manual: true });
    setMessage("応援歌を停止しました。");
  }

  renderButtons();
}

function handleAnthemRestartButton() {
  if (!state.anthemAudio) {
    setMessage("先に応援歌音源を設定してください。", true);
    return;
  }

  state.anthemManuallyStopped = false;
  stopAnthem({ reset: true });
  keepAnthemPlaying({ force: true });
  setMessage("応援歌を最初から再生しました。");
  renderButtons();
}

function handleAnthemStopButton() {
  stopAnthem({ manual: true });
  setMessage("応援歌を停止しました。");
  renderButtons();
}

function applyTickets({ silent = false } = {}) {
  const parsed = sortTicketNumbers(parseTicketText(elements.ticketInput.value));
  state.tickets = parsed;
  state.sourceText = parsed.join("\n");
  state.winners = state.winners.filter((winner) => parsed.includes(winner.number));
  elements.ticketInput.value = state.sourceText;

  if (!silent) {
    setMessage(parsed.length ? `${parsed.length}件の整理券番号を登録しました。` : "番号を入力してください。", parsed.length === 0);
  }

  saveState();
  render();
}

function addRange() {
  const startRaw = elements.rangeStart.value.trim();
  const endRaw = elements.rangeEnd.value.trim();
  const start = Number(startRaw);
  const end = Number(endRaw);

  if (!/^\d+$/.test(startRaw) || !/^\d+$/.test(endRaw) || !Number.isFinite(start) || !Number.isFinite(end)) {
    setMessage("開始と終了には数字だけを入力してください。", true);
    return;
  }

  if (start > end) {
    setMessage("開始番号は終了番号以下にしてください。", true);
    return;
  }

  if (end - start > 9999) {
    setMessage("一度に追加できる範囲は10,000件までです。", true);
    return;
  }

  const width = Math.max(startRaw.length, endRaw.length);
  const existing = parseTicketText(elements.ticketInput.value);
  const additions = [];

  for (let value = start; value <= end; value += 1) {
    additions.push(String(value).padStart(width, "0"));
  }

  const merged = sortTicketNumbers(uniqueValues([...existing, ...additions]));
  elements.ticketInput.value = merged.join("\n");
  elements.rangeStart.value = "";
  elements.rangeEnd.value = "";
  applyTickets({ silent: true });
  setMessage(`${additions.length}件の範囲を追加しました。`);
}

function startSpin() {
  const remaining = getRemainingTickets();
  if (state.spinning) {
    stopSpin();
    return;
  }

  if (remaining.length === 0) {
    setMessage(state.tickets.length ? "抽選できる番号が残っていません。" : "先に整理券番号を登録してください。", true);
    return;
  }

  state.spinning = true;
  window.clearTimeout(state.winnerShowcaseTimer);
  elements.slotNumber.classList.remove("winner", "winner-showcase");
  elements.slotNumber.classList.add("spinning");
  elements.drawLabel.textContent = "抽選中";
  elements.drawButtonLabel.textContent = "決定";
  elements.drawIcon.innerHTML = '<path d="M6 6h12v12H6z" />';
  renderButtons();
  startSpinEffects();

  state.spinTimer = window.setInterval(() => {
    elements.slotNumber.textContent = chooseTicket(remaining);
    fitSlotNumber();
  }, SPIN_TICK_MS);
}

function stopSpin() {
  if (!state.spinning) {
    return;
  }

  window.clearInterval(state.spinTimer);
  state.spinTimer = 0;
  state.spinning = false;

  const remaining = getRemainingTickets();
  if (!remaining.length) {
    cancelSpinEffects();
    render();
    return;
  }

  const winner = chooseTicket(remaining);
  state.winners.unshift({
    number: winner,
    drawnAt: new Date().toISOString(),
  });

  elements.slotNumber.textContent = winner;
  window.clearTimeout(state.winnerShowcaseTimer);
  elements.slotNumber.classList.remove("spinning", "winner", "winner-showcase");
  void elements.slotNumber.offsetWidth;
  elements.slotNumber.classList.add("winner", "winner-showcase");
  state.winnerShowcaseTimer = window.setTimeout(() => {
    elements.slotNumber.classList.remove("winner-showcase");
  }, 1180);
  elements.drawLabel.textContent = `当選番号 ${winner}`;
  setMessage(`${winner} を当選番号に追加しました。`);
  saveState();
  render();
  fitSlotNumber();
  finishSpinEffects();
}

function undoLastWinner() {
  if (!state.winners.length || state.spinning) {
    return;
  }

  const [removed] = state.winners.splice(0, 1);
  elements.slotNumber.textContent = removed?.number || "---";
  elements.drawLabel.textContent = "直前の当選を取り消しました";
  setMessage(removed ? `${removed.number} を抽選対象に戻しました。` : "");
  saveState();
  render();
}

function removeWinner(index) {
  if (state.spinning) {
    return;
  }

  const [removed] = state.winners.splice(index, 1);
  if (removed) {
    elements.drawLabel.textContent = `${removed.number} を抽選対象に戻しました`;
    setMessage(`${removed.number} を履歴から戻しました。`);
  }
  saveState();
  render();
}

function clearHistory() {
  if (!state.winners.length || state.spinning) {
    return;
  }

  const confirmed = window.confirm("当選履歴をすべてクリアしますか？番号リストは残ります。");
  if (!confirmed) {
    return;
  }

  state.winners = [];
  elements.slotNumber.textContent = "---";
  elements.drawLabel.textContent = "抽選待機中";
  setMessage("当選履歴をクリアしました。");
  saveState();
  render();
}

function clearAll() {
  if (state.spinning) {
    return;
  }

  const confirmed = window.confirm("登録番号と当選履歴をすべて初期化しますか？");
  if (!confirmed) {
    return;
  }

  state.tickets = [];
  state.winners = [];
  state.sourceText = "";
  elements.ticketInput.value = "";
  elements.slotNumber.textContent = "---";
  elements.drawLabel.textContent = "抽選待機中";
  localStorage.removeItem(STORAGE_KEY);
  setMessage("すべて初期化しました。");
  render();
}

function exportWinners() {
  if (!state.winners.length) {
    return;
  }

  const rows = [["順位", "整理券番号", "抽選日時"]];
  [...state.winners].reverse().forEach((winner, index) => {
    rows.push([String(index + 1), winner.number, formatDateTime(winner.drawnAt)]);
  });

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");

  link.href = url;
  link.download = `ticket-winners-${stamp}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function openWinnerSummary() {
  renderWinnerSummary();
  elements.winnerSummaryModal.hidden = false;
  document.body.classList.add("modal-open");
  elements.winnerSummaryCloseButton.focus();
}

function closeWinnerSummary() {
  elements.winnerSummaryModal.hidden = true;
  document.body.classList.remove("modal-open");
  if (!elements.winnerSummaryButton.disabled) {
    elements.winnerSummaryButton.focus();
  }
}

function escapeCsv(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function setSample() {
  const sample = Array.from({ length: 80 }, (_, index) => String(index + 1).padStart(3, "0"));
  elements.ticketInput.value = sample.join("\n");
  applyTickets({ silent: true });
  setMessage("001から080までのサンプル番号を登録しました。");
}

function setMessage(text, isError = false) {
  elements.inputMessage.textContent = text;
  elements.inputMessage.classList.toggle("error", Boolean(isError));
}

function render() {
  renderButtons();
  renderWinners();
  if (!elements.winnerSummaryModal.hidden) {
    renderWinnerSummary();
  }

  if (!state.spinning) {
    elements.drawButtonLabel.textContent = "抽選開始";
    elements.drawIcon.innerHTML = '<path d="M5 3l14 9-14 9V3Z" />';
    elements.slotNumber.classList.remove("spinning");
  }
}

function renderButtons() {
  const remaining = getRemainingTickets();
  elements.drawButton.disabled = !state.spinning && remaining.length === 0;
  elements.undoButton.disabled = state.spinning || state.winners.length === 0;
  elements.exportButton.disabled = state.spinning || state.winners.length === 0;
  elements.winnerSummaryButton.disabled = state.winners.length === 0;
  elements.clearHistoryButton.disabled = state.spinning || state.winners.length === 0;
  elements.applyButton.disabled = state.spinning;
  elements.addRangeButton.disabled = state.spinning;
  elements.sampleButton.disabled = state.spinning;
  elements.clearAllButton.disabled = state.spinning;
  const anthemReady = Boolean(state.anthemAudio);
  const anthemPlaying = anthemReady && !state.anthemAudio.paused && !state.anthemManuallyStopped;

  elements.anthemButton.disabled = state.spinning;
  elements.anthemToggleButton.disabled = !anthemReady;
  elements.anthemRestartButton.disabled = !anthemReady;
  elements.anthemToggleIcon.innerHTML = anthemPlaying ? '<path d="M6 5h4v14H6z" /><path d="M14 5h4v14h-4z" />' : '<path d="M8 5v14l11-7-11-7Z" />';
  elements.anthemToggleLabel.textContent = anthemPlaying ? "停止" : "再生";
  elements.anthemToggleButton.title = anthemPlaying ? "応援歌を停止" : "応援歌を再生";
}

function renderWinners() {
  elements.winnerList.replaceChildren();
  elements.winnerList.classList.toggle("is-sparse", state.winners.length > 0 && state.winners.length <= 6);

  state.winners.forEach((winner, index) => {
    const fragment = elements.winnerItemTemplate.content.cloneNode(true);
    const item = fragment.querySelector("li");
    const rank = fragment.querySelector(".winner-rank");
    const number = fragment.querySelector(".winner-number");
    const time = fragment.querySelector(".winner-time");
    const button = fragment.querySelector("button");

    rank.textContent = `#${state.winners.length - index}`;
    number.textContent = winner.number;
    time.textContent = formatDateTime(winner.drawnAt);
    button.addEventListener("click", () => removeWinner(index));
    item.dataset.number = winner.number;

    elements.winnerList.append(fragment);
  });
}

function renderWinnerSummary() {
  elements.winnerSummaryGrid.replaceChildren();
  elements.winnerSummaryGrid.hidden = state.winners.length === 0;

  state.winners.forEach((winner, index) => {
    const card = document.createElement("div");
    const rank = document.createElement("span");
    const number = document.createElement("strong");

    card.className = "winner-summary-card";
    rank.className = "winner-summary-rank";
    number.className = "winner-summary-number";
    rank.textContent = `#${state.winners.length - index}`;
    number.textContent = winner.number;
    number.style.setProperty("--winner-number-size", getWinnerSummaryNumberSize(winner.number));

    card.append(rank, number);
    elements.winnerSummaryGrid.append(card);
  });
}

function getWinnerSummaryNumberSize(value) {
  const length = String(value).length;

  if (length <= 3) {
    return "clamp(3rem, 4vw, 4.4rem)";
  }
  if (length <= 4) {
    return "clamp(2.6rem, 3.4vw, 3.8rem)";
  }
  if (length <= 6) {
    return "clamp(2.1rem, 2.7vw, 3rem)";
  }
  if (length <= 8) {
    return "clamp(1.7rem, 2.2vw, 2.4rem)";
  }

  return "clamp(1.3rem, 1.8vw, 2rem)";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function fitSlotNumber() {
  const value = elements.slotNumber.textContent || "";
  const length = value.length;
  let size = "9.5rem";

  if (length > 4 && length <= 6) {
    size = "7rem";
  } else if (length > 6 && length <= 8) {
    size = "5.5rem";
  } else if (length > 8) {
    size = "3.8rem";
  }

  elements.slotNumber.style.setProperty("--reel-size", size);
}

function bindEvents() {
  elements.applyButton.addEventListener("click", () => applyTickets());
  elements.addRangeButton.addEventListener("click", addRange);
  elements.sampleButton.addEventListener("click", setSample);
  elements.drawButton.addEventListener("click", startSpin);
  elements.undoButton.addEventListener("click", undoLastWinner);
  elements.exportButton.addEventListener("click", exportWinners);
  elements.winnerSummaryButton.addEventListener("click", openWinnerSummary);
  elements.winnerSummaryCloseButton.addEventListener("click", closeWinnerSummary);
  elements.winnerSummaryModal.addEventListener("click", (event) => {
    if (event.target === elements.winnerSummaryModal || event.target?.classList?.contains("winner-modal-backdrop")) {
      closeWinnerSummary();
    }
  });
  elements.anthemButton.addEventListener("click", handleAnthemButton);
  elements.anthemToggleButton.addEventListener("click", handleAnthemToggleButton);
  elements.anthemRestartButton.addEventListener("click", handleAnthemRestartButton);
  elements.anthemInput.addEventListener("change", setAnthemAudio);
  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.clearAllButton.addEventListener("click", clearAll);

  elements.ticketInput.addEventListener("blur", () => {
    if (elements.ticketInput.value !== state.sourceText) {
      applyTickets({ silent: true });
      setMessage("入力内容を保存しました。");
    }
  });

  window.addEventListener("resize", fitSlotNumber);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.winnerSummaryModal.hidden) {
      closeWinnerSummary();
    }
  });
}

function init() {
  loadState();
  loadDefaultAnthemAudio();
  elements.ticketInput.value = state.sourceText;
  const lastWinner = state.winners[0]?.number;
  elements.slotNumber.textContent = lastWinner || "---";
  elements.drawLabel.textContent = lastWinner ? `前回の当選番号 ${lastWinner}` : "抽選待機中";
  bindEvents();
  render();
  fitSlotNumber();
}

init();
