const STORAGE_KEY = "ticket-slot-draw-state-v1";
const SPIN_TICK_MS = 58;
const AUTO_STOP_MS = 3600;

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
  inputMessage: document.querySelector("#inputMessage"),
  slotNumber: document.querySelector("#slotNumber"),
  drawLabel: document.querySelector("#drawLabel"),
  totalCount: document.querySelector("#totalCount"),
  remainingCount: document.querySelector("#remainingCount"),
  winnerCount: document.querySelector("#winnerCount"),
  winnerList: document.querySelector("#winnerList"),
  emptyHistory: document.querySelector("#emptyHistory"),
  winnerItemTemplate: document.querySelector("#winnerItemTemplate"),
};

const state = {
  tickets: [],
  winners: [],
  sourceText: "",
  spinning: false,
  spinTimer: 0,
  autoStopTimer: 0,
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
  elements.slotNumber.classList.remove("winner");
  elements.slotNumber.classList.add("spinning");
  elements.drawLabel.textContent = "抽選中";
  elements.drawButtonLabel.textContent = "決定";
  elements.drawIcon.innerHTML = '<path d="M6 6h12v12H6z" />';
  renderButtons();

  state.spinTimer = window.setInterval(() => {
    elements.slotNumber.textContent = chooseTicket(remaining);
    fitSlotNumber();
  }, SPIN_TICK_MS);

  state.autoStopTimer = window.setTimeout(stopSpin, AUTO_STOP_MS);
}

function stopSpin() {
  if (!state.spinning) {
    return;
  }

  window.clearInterval(state.spinTimer);
  window.clearTimeout(state.autoStopTimer);
  state.spinTimer = 0;
  state.autoStopTimer = 0;
  state.spinning = false;

  const remaining = getRemainingTickets();
  if (!remaining.length) {
    render();
    return;
  }

  const winner = chooseTicket(remaining);
  state.winners.unshift({
    number: winner,
    drawnAt: new Date().toISOString(),
  });

  elements.slotNumber.textContent = winner;
  elements.slotNumber.classList.remove("spinning");
  elements.slotNumber.classList.add("winner");
  elements.drawLabel.textContent = `当選番号 ${winner}`;
  setMessage(`${winner} を当選番号に追加しました。`);
  saveState();
  render();
  fitSlotNumber();
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
  const remaining = getRemainingTickets();

  elements.totalCount.textContent = state.tickets.length;
  elements.remainingCount.textContent = remaining.length;
  elements.winnerCount.textContent = state.winners.length;
  elements.emptyHistory.hidden = state.winners.length > 0;
  renderButtons();
  renderWinners();

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
  elements.clearHistoryButton.disabled = state.spinning || state.winners.length === 0;
  elements.applyButton.disabled = state.spinning;
  elements.addRangeButton.disabled = state.spinning;
  elements.sampleButton.disabled = state.spinning;
  elements.clearAllButton.disabled = state.spinning;
}

function renderWinners() {
  elements.winnerList.replaceChildren();

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
  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.clearAllButton.addEventListener("click", clearAll);

  elements.ticketInput.addEventListener("blur", () => {
    if (elements.ticketInput.value !== state.sourceText) {
      applyTickets({ silent: true });
      setMessage("入力内容を保存しました。");
    }
  });

  window.addEventListener("resize", fitSlotNumber);
}

function init() {
  loadState();
  elements.ticketInput.value = state.sourceText;
  const lastWinner = state.winners[0]?.number;
  elements.slotNumber.textContent = lastWinner || "---";
  elements.drawLabel.textContent = lastWinner ? `前回の当選番号 ${lastWinner}` : "抽選待機中";
  bindEvents();
  render();
  fitSlotNumber();
}

init();
