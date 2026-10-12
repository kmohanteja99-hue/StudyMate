
"use strict";

/* =====================================================
   STUDYMATE — NO API REQUIRED
   Tasks, calendar, subjects, analytics, timer and alerts
   ===================================================== */

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const STORAGE_KEY = "studymate-data-v1";
const CIRCUMFERENCE = 2 * Math.PI * 94;

const SUBJECTS = [
  "General", "Mathematics", "Science", "Physics", "Chemistry",
  "Biology", "English", "Social Studies", "Computer Science", "Other"
];

const QUOTES = [
  ["The secret of getting ahead is getting started.", "Mark Twain"],
  ["It always seems impossible until it's done.", "Nelson Mandela"],
  ["Believe you can and you're halfway there.", "Theodore Roosevelt"],
  ["The future depends on what you do today.", "Mahatma Gandhi"],
  ["Great things are done by a series of small things brought together.", "Vincent van Gogh"],
  ["You don't have to be perfect to make progress.", "StudyMate"],
  ["Small daily improvements lead to remarkable results.", "StudyMate"]
];

function dateKey(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function defaultData() {
  return {
    tasks: [],
    notes: [],
    sessions: { date: dateKey(), count: 0 },
    studyLog: [],
    theme: "dark",
    quoteIndex: 0,
    soundEnabled: true,
    notificationsEnabled: false
  };
}

function normalizeData(saved) {
  const base = defaultData();
  if (!saved || typeof saved !== "object") return base;

  base.tasks = Array.isArray(saved.tasks)
    ? saved.tasks.filter(task => task && typeof task === "object").map(task => ({
        ...task,
        id: task.id || uid(),
        title: String(task.title || "Untitled task"),
        priority: ["High", "Medium", "Low"].includes(task.priority) ? task.priority : "Medium",
        subject: SUBJECTS.includes(task.subject) ? task.subject : "General",
        dueDate: validDate(task.dueDate) ? task.dueDate :
          validDate(task.createdDate) ? task.createdDate : dateKey(),
        createdDate: validDate(task.createdDate) ? task.createdDate : dateKey(),
        completed: Boolean(task.completed),
        completedAt: task.completedAt || null
      }))
    : [];

  base.notes = Array.isArray(saved.notes)
    ? saved.notes.filter(note => note && typeof note === "object").map(note => ({
        ...note,
        id: note.id || uid(),
        title: String(note.title || "Untitled note"),
        body: String(note.body || ""),
        createdAt: note.createdAt || new Date().toISOString(),
        updatedAt: note.updatedAt || note.createdAt || new Date().toISOString()
      }))
    : [];

  base.sessions = saved.sessions && typeof saved.sessions === "object"
    ? saved.sessions : base.sessions;

  if (!validDate(base.sessions.date)) base.sessions.date = dateKey();
  if (!Number.isFinite(Number(base.sessions.count))) base.sessions.count = 0;

  base.studyLog = Array.isArray(saved.studyLog)
    ? saved.studyLog.filter(item =>
        item && validDate(item.date) &&
        Number.isFinite(Number(item.minutes)) &&
        Number(item.minutes) > 0
      ).map(item => ({
        id: item.id || uid(),
        date: item.date,
        subject: SUBJECTS.includes(item.subject) ? item.subject : "General",
        minutes: Math.max(1, Math.round(Number(item.minutes)))
      }))
    : [];

  base.theme = saved.theme === "light" ? "light" : "dark";
  base.quoteIndex = Number.isInteger(saved.quoteIndex) ? saved.quoteIndex : 0;
  base.soundEnabled = saved.soundEnabled !== false;
  base.notificationsEnabled = Boolean(saved.notificationsEnabled);

  return base;
}

function loadData() {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch (error) {
    console.warn("StudyMate could not read saved data.", error);
    return defaultData();
  }
}

let data = loadData();
let taskFilter = "all";
let editingNoteId = null;
let toastTimeout = null;
let timerInterval = null;
let timerEndAt = null;
let timerMode = "focus";
let timerDuration = 25 * 60;
let remainingSeconds = timerDuration;
let timerRunning = false;
let calendarDate = new Date();
let selectedDate = new Date();
let audioContext = null;

/* Storage and common helpers */

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("StudyMate storage error:", error);
    showToast("Could not save. Export your data or free browser storage.");
    return false;
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function formatDate(value, options = { month: "short", day: "numeric" }) {
  const parts = String(value).split("-").map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return value;
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, options);
}

function getTodayTasks() {
  const today = dateKey();
  return data.tasks.filter(task => task.dueDate === today);
}

/* Greeting and statistics */

function updateGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning!" :
    hour < 17 ? "Good afternoon!" : "Good evening!";

  $("#greeting").textContent = greeting + " Ready to make today count?";
  $("#todayLabel").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  }).toUpperCase();
}

function minutesForDate(date) {
  return data.studyLog
    .filter(entry => entry.date === date)
    .reduce((sum, entry) => sum + entry.minutes, 0);
}

function updateStats() {
  if (data.sessions.date !== dateKey()) {
    data.sessions = { date: dateKey(), count: 0 };
    saveData();
  }

  const todayTasks = getTodayTasks();
  const completedToday = todayTasks.filter(task => task.completed).length;
  const allCompleted = data.tasks.filter(task => task.completed).length;
  const percent = data.tasks.length
    ? Math.round(allCompleted / data.tasks.length * 100) : 0;

  $("#taskStat").textContent = todayTasks.length;
  $("#taskStatSub").textContent = `${completedToday} completed today`;
  $("#minutesStat").textContent = minutesForDate(dateKey());
  $("#sessionStat").textContent = `${data.sessions.count} completed today`;
  $("#noteStat").textContent = data.notes.length;
  $("#completionStat").textContent = percent + "%";
  $("#completionSub").textContent = `${allCompleted} of ${data.tasks.length} tasks`;
  $("#taskCount").textContent =
    `${data.tasks.length} task${data.tasks.length === 1 ? "" : "s"}`;
}

/* Task manager */

function renderTasks() {
  const list = $("#taskList");
  list.replaceChildren();

  const filtered = data.tasks.filter(task => {
    if (taskFilter === "active") return !task.completed;
    if (taskFilter === "completed") return task.completed;
    return true;
  }).sort((a, b) => {
    if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    const priority = { High: 0, Medium: 1, Low: 2 };
    return priority[a.priority] - priority[b.priority];
  });

  $("#taskEmpty").classList.toggle("hidden", filtered.length > 0);
  if (!filtered.length) {
    $("#taskEmpty").textContent = taskFilter === "completed"
      ? "No completed tasks yet."
      : taskFilter === "active"
        ? "You're all caught up. Add a task when you're ready."
        : "✨ Add your first task to get started.";
  }

  filtered.forEach(task => {
    const row = makeElement("div", "task-item" + (task.completed ? " done" : ""));
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-check";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", "Mark task complete");

    checkbox.addEventListener("change", () => {
      task.completed = checkbox.checked;
      task.completedAt = task.completed ? new Date().toISOString() : null;
      saveData();
      renderTasks();
      renderCalendar();
      renderAnalytics();
      updateStats();
    });

    const name = makeElement("span", "task-name", task.title);
    const meta = makeElement("div", "task-meta");
    meta.append(
      makeElement("span", "subject-tag", task.subject),
      makeElement("span", "priority " + task.priority, task.priority)
    );

    const due = makeElement("span", "task-date", formatDate(task.dueDate));
    due.title = "Due date: " + task.dueDate;

    const remove = makeElement("button", "delete-btn", "×");
    remove.type = "button";
    remove.title = "Delete task";
    remove.setAttribute("aria-label", "Delete " + task.title);
    remove.addEventListener("click", () => {
      data.tasks = data.tasks.filter(item => item.id !== task.id);
      saveData();
      renderTasks();
      renderCalendar();
      updateStats();
      showToast("Task deleted");
    });

    row.append(checkbox, name, meta, due, remove);
    list.append(row);
  });

  updateStats();
}

function setTaskFilter(filter) {
  taskFilter = filter;
  $$("#taskFilters .filter-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
  renderTasks();
}

$("#taskForm").addEventListener("submit", event => {
  event.preventDefault();

  const title = $("#taskInput").value.trim();
  const dueDate = $("#taskDate").value;
  if (!title || !validDate(dueDate)) {
    showToast("Enter a task and choose a valid date.");
    return;
  }

  data.tasks.push({
    id: uid(),
    title,
    subject: SUBJECTS.includes($("#taskSubject").value) ? $("#taskSubject").value : "General",
    priority: $("#taskPriority").value,
    dueDate,
    createdDate: dateKey(),
    completed: false,
    completedAt: null
  });

  saveData();
  $("#taskInput").value = "";
  $("#taskDate").value = dateKey();
  setTaskFilter("all");
  renderCalendar();
  updateStats();
  showToast("Task added!");
});

$("#taskFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (button) setTaskFilter(button.dataset.filter);
});

/* Calendar */

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  $("#calendarTitle").textContent = calendarDate.toLocaleDateString(undefined, {
    month: "long", year: "numeric"
  });

  const grid = $("#calendarGrid");
  grid.replaceChildren();

  ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach(day => {
    grid.append(makeElement("div", "calendar-cell weekday", day));
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    grid.append(makeElement("div", "calendar-cell"));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const key = dateKey(date);
    const cell = makeElement("button", "calendar-cell day", day);
    cell.type = "button";
    cell.setAttribute("aria-label", formatDate(key, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    }));

    if (sameDay(date, new Date())) cell.classList.add("today");
    if (sameDay(date, selectedDate)) cell.classList.add("selected");
    if (data.tasks.some(task => task.dueDate === key)) cell.classList.add("has-tasks");

    cell.addEventListener("click", () => {
      selectedDate = date;
      renderCalendar();
    });

    grid.append(cell);
  }

  renderSelectedDate();
}

function renderSelectedDate() {
  const key = dateKey(selectedDate);
  const tasks = data.tasks.filter(task => task.dueDate === key);

  $("#selectedDateLabel").textContent = formatDate(key, {
    weekday: "long", month: "short", day: "numeric"
  });
  $("#selectedDateCount").textContent =
    `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;

  const list = $("#calendarTaskList");
  list.replaceChildren();

  if (!tasks.length) {
    list.append(makeElement("div", "empty-state", "No tasks scheduled for this date."));
    return;
  }

  tasks.forEach(task => {
    const row = makeElement("div", "calendar-task" + (task.completed ? " done" : ""));
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.className = "task-check";
    checkbox.setAttribute("aria-label", "Complete " + task.title);

    checkbox.addEventListener("change", () => {
      task.completed = checkbox.checked;
      task.completedAt = task.completed ? new Date().toISOString() : null;
      saveData();
      renderTasks();
      renderCalendar();
      renderAnalytics();
      updateStats();
    });

    const name = makeElement("span", "", task.title);
    const subject = makeElement("span", "subject-tag", task.subject);
    row.append(checkbox, name, subject);
    list.append(row);
  });
}

$("#prevMonth").addEventListener("click", () => {
  calendarDate = new Date(
    calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1
  );
  renderCalendar();
});

$("#nextMonth").addEventListener("click", () => {
  calendarDate = new Date(
    calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1
  );
  renderCalendar();
});

$("#planDateBtn").addEventListener("click", () => {
  $("#taskDate").value = dateKey(selectedDate);
  $("#tasks").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#taskInput").focus({ preventScroll: true });
  showToast("Choose your subject and add the task.");
});

/* Study analytics */

function renderAnalytics() {
  const today = new Date();
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push({ date: dateKey(day), label: day.toLocaleDateString(undefined, { weekday: "short" }) });
  }

  const values = days.map(day => minutesForDate(day.date));
  const total = values.reduce((sum, value) => sum + value, 0);

  $("#weeklyMinutes").textContent = `${total} min`;
  $("#dailyAverage").textContent = `${Math.round(total / 7)} min`;

  const chart = $("#weeklyChart");
  chart.replaceChildren();
  const maxValue = Math.max(...values, 1);

  days.forEach((day, index) => {
    const column = makeElement("div", "chart-day");
    const area = makeElement("div", "chart-bar-area");
    const bar = makeElement("div", "chart-bar");
    const height = values[index] === 0 ? 3 : Math.max(8, values[index] / maxValue * 100);

    bar.style.height = height + "%";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${day.label}: ${values[index]} minutes`);
    bar.title = `${day.date}: ${values[index]} focus minutes`;

    if (values[index] > 0) {
      bar.append(makeElement("span", "", values[index]));
    }

    area.append(bar);
    column.append(area, makeElement("small", "", day.label));
    chart.append(column);
  });

  const totals = {};
  data.studyLog.forEach(entry => {
    totals[entry.subject] = (totals[entry.subject] || 0) + entry.minutes;
  });

  const subjects = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const subjectList = $("#subjectAnalytics");
  subjectList.replaceChildren();
  $("#analyticsEmpty").classList.toggle("hidden", subjects.length > 0);

  const subjectMax = Math.max(...subjects.map(item => item[1]), 1);

  subjects.forEach(([subject, minutes]) => {
    const row = makeElement("div", "subject-row");
    const top = makeElement("div", "subject-row-top");
    top.append(
      makeElement("span", "", subject),
      makeElement("span", "", `${minutes} min`)
    );

    const track = makeElement("div", "subject-track");
    const fill = makeElement("div", "subject-fill");
    fill.style.width = `${minutes / subjectMax * 100}%`;
    track.append(fill);
    row.append(top, track);
    subjectList.append(row);
  });
}

/* Focus timer and study records */

function stopTimer() {
  if (timerInterval !== null) clearInterval(timerInterval);
  timerInterval = null;
  timerEndAt = null;
  timerRunning = false;
}

function updateTimerDisplay() {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  $("#timerDisplay").textContent =
    String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");

  const progress = timerDuration ? remainingSeconds / timerDuration : 0;
  $("#timerProgress").style.strokeDasharray = CIRCUMFERENCE;
  $("#timerProgress").style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  $("#timerModeLabel").textContent = timerMode === "focus"
    ? "FOCUS" : timerMode === "short" ? "SHORT BREAK" : "LONG BREAK";
  $("#timerModeText").textContent = timerMode === "focus" ? "Focus time" : "Break time";
  $("#timerHint").textContent = timerRunning
    ? "Stay with one task. You've got this."
    : remainingSeconds === 0
      ? "Session complete. Choose another session."
      : "Choose a session and press Start.";

  $("#startTimer").textContent = timerRunning ? "Ⅱ Pause" : "▶ Start";
}

function setTimerMode(mode, minutes) {
  stopTimer();
  timerMode = mode;
  timerDuration = minutes * 60;
  remainingSeconds = timerDuration;

  $$(".timer-modes [data-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  updateTimerDisplay();
}

$$(".timer-modes [data-mode]").forEach(button => {
  button.addEventListener("click", () => {
    setTimerMode(button.dataset.mode, Number(button.dataset.minutes));
  });
});

function recordFocusSession() {
  const today = dateKey();

  if (data.sessions.date !== today) {
    data.sessions = { date: today, count: 0 };
  }

  data.sessions.count++;

  const subject = SUBJECTS.includes($("#focusSubject").value)
    ? $("#focusSubject").value : "General";

  data.studyLog.push({
    id: uid(),
    date: today,
    subject,
    minutes: Math.round(timerDuration / 60)
  });

  saveData();
  updateStats();
  renderAnalytics();
}

function playAlert() {
  if (!data.soundEnabled) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      showToast("Timer complete!");
      return;
    }

    if (!audioContext) audioContext = new AudioContextClass();

    const playTone = () => {
      [0, 1, 2].forEach((index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = audioContext.currentTime + index * 0.23;

        oscillator.type = "sine";
        oscillator.frequency.value = index === 1 ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.2);
      });
    };

    if (audioContext.state === "suspended") {
      audioContext.resume().then(playTone).catch(() => {});
    } else {
      playTone();
    }
  } catch (error) {
    console.warn("Audio alert unavailable:", error);
  }
}

function notifyTimerFinished(title, body) {
  if (data.notificationsEnabled &&
      "Notification" in window &&
      Notification.permission === "granted") {
    try {
      const notification = new Notification(title, {
        body,
        tag: "studymate-timer"
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (error) {
      console.warn("Browser notification unavailable:", error);
    }
  }
}

function finishTimer() {
  stopTimer();
  remainingSeconds = 0;
  updateTimerDisplay();

  if (timerMode === "focus") {
    recordFocusSession();
    showToast("Focus session complete! Great work 🎉");
    notifyTimerFinished("StudyMate: Focus complete!", "Your study session is finished. Take a break.");
  } else {
    showToast("Break complete. Ready to focus again?");
    notifyTimerFinished("StudyMate: Break complete!", "Your break is over when you're ready.");
  }

  playAlert();
  $("#startTimer").textContent = "▶ Start";
  $("#timerHint").textContent = "Session finished. Choose what comes next.";
}

function tickTimer() {
  if (!timerRunning || timerEndAt === null) return;

  remainingSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
  updateTimerDisplay();

  if (remainingSeconds <= 0) finishTimer();
}

$("#startTimer").addEventListener("click", async () => {
  if (timerRunning) {
    tickTimer();
    if (remainingSeconds <= 0) return;

    stopTimer();
    updateTimerDisplay();
    return;
  }

  if (remainingSeconds <= 0) remainingSeconds = timerDuration;

  try {
    if (data.soundEnabled && audioContext && audioContext.state === "suspended") {
      await audioContext.resume();
    }
  } catch {}

  timerRunning = true;
  timerEndAt = Date.now() + remainingSeconds * 1000;
  updateTimerDisplay();
  timerInterval = setInterval(tickTimer, 250);
});

$("#resetTimer").addEventListener("click", () => {
  stopTimer();
  remainingSeconds = timerDuration;
  updateTimerDisplay();
  showToast("Timer reset");
});

/* Notes */

function resetNoteForm() {
  editingNoteId = null;
  $("#noteForm").reset();
  $("#noteForm").classList.add("hidden");
  $("#saveNoteBtn").textContent = "Save note";
}

function renderNotes() {
  const list = $("#noteList");
  list.replaceChildren();

  const query = $("#noteSearch").value.trim().toLowerCase();
  const filtered = data.notes.filter(note =>
    (note.title + " " + note.body).toLowerCase().includes(query)
  );

  $("#noteEmpty").classList.toggle("hidden", filtered.length > 0);
  if (!filtered.length) {
    $("#noteEmpty").textContent = query
      ? "No notes match your search."
      : "📝 Your ideas belong here. Create a note!";
  }

  filtered.forEach(note => {
    const card = makeElement("article", "note-card");
    const title = makeElement("h3", "", note.title);
    const body = makeElement("p", "", note.body);
    const meta = makeElement("div", "note-meta",
      new Date(note.updatedAt).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      })
    );

    const actions = makeElement("div", "note-actions");
    const edit = makeElement("button", "secondary-btn", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => {
      editingNoteId = note.id;
      $("#noteTitle").value = note.title;
      $("#noteBody").value = note.body;
      $("#saveNoteBtn").textContent = "Update note";
      $("#noteForm").classList.remove("hidden");
      $("#noteForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
      $("#noteTitle").focus();
    });

    const remove = makeElement("button", "secondary-btn", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (!confirm(`Delete "${note.title}"?`)) return;
      data.notes = data.notes.filter(item => item.id !== note.id);
      if (editingNoteId === note.id) resetNoteForm();
      saveData();
      renderNotes();
      updateStats();
      showToast("Note deleted");
    });

    actions.append(edit, remove);
    card.append(title, body, meta, actions);
    list.append(card);
  });

  updateStats();
}

$("#newNoteBtn").addEventListener("click", () => {
  resetNoteForm();
  $("#noteForm").classList.remove("hidden");
  $("#noteTitle").focus();
});

$("#cancelNoteBtn").addEventListener("click", resetNoteForm);
$("#noteSearch").addEventListener("input", renderNotes);

$("#noteForm").addEventListener("submit", event => {
  event.preventDefault();

  const title = $("#noteTitle").value.trim();
  const body = $("#noteBody").value.trim();
  if (!title || !body) return;

  const now = new Date().toISOString();

  if (editingNoteId) {
    const note = data.notes.find(item => item.id === editingNoteId);
    if (note) {
      note.title = title;
      note.body = body;
      note.updatedAt = now;
    }
    showToast("Note updated!");
  } else {
    data.notes.unshift({
      id: uid(), title, body, createdAt: now, updatedAt: now
    });
    showToast("Note saved!");
  }

  saveData();
  resetNoteForm();
  renderNotes();
});

/* Theme */

function applyTheme() {
  document.body.classList.toggle("light", data.theme === "light");
  $("#themeBtn").textContent = data.theme === "light" ? "☾" : "☼";
  $("#settingsThemeBtn").textContent = data.theme === "light"
    ? "Switch to dark" : "Switch to light";
}

function toggleTheme() {
  data.theme = data.theme === "light" ? "dark" : "light";
  saveData();
  applyTheme();
}

$("#themeBtn").addEventListener("click", toggleTheme);
$("#settingsThemeBtn").addEventListener("click", toggleTheme);

/* Sound and browser notifications */

function renderNotificationSettings() {
  $("#soundToggle").checked = data.soundEnabled;

  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "unsupported";

  $("#notificationBtn").disabled = !supported || permission === "granted";
  $("#notificationBtn").textContent = !supported
    ? "Unsupported"
    : permission === "granted" ? "Enabled"
    : permission === "denied" ? "Blocked in browser" : "Enable";

  $("#notificationStatus").textContent = !supported
    ? "This browser does not support notifications."
    : permission === "granted"
      ? "Browser permission granted."
      : permission === "denied"
        ? "Notifications are blocked in browser settings."
        : "Click Enable and allow notifications.";
}

$("#soundToggle").addEventListener("change", () => {
  data.soundEnabled = $("#soundToggle").checked;
  saveData();
  showToast(data.soundEnabled ? "Sound alerts enabled" : "Sound alerts disabled");
});

$("#notificationBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("Notifications are not supported by this browser.");
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    data.notificationsEnabled = permission === "granted";
    saveData();
    renderNotificationSettings();

    if (permission === "granted") {
      showToast("Browser notifications enabled!");
      new Notification("StudyMate is ready", {
        body: "You can receive timer completion notifications."
      });
    } else {
      showToast("Notifications were not enabled. Check browser settings.");
    }
  } catch (error) {
    showToast("Could not request notification permission.");
  }
});

/* Export a backup */

function exportData() {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "studymate-backup-" + dateKey() + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Backup downloaded!");
  } catch (error) {
    showToast("Could not export data.");
  }
}

$("#exportBtn").addEventListener("click", exportData);
$("#settingsExportBtn").addEventListener("click", exportData);

/* Quotes */

function renderQuote() {
  const index = ((data.quoteIndex % QUOTES.length) + QUOTES.length) % QUOTES.length;
  const quote = QUOTES[index];
  $("#quoteText").textContent = "“" + quote[0] + "”";
  $("#quoteAuthor").textContent = "— " + quote[1];
}

$("#newQuoteBtn").addEventListener("click", () => {
  data.quoteIndex = (data.quoteIndex + 1) % QUOTES.length;
  saveData();
  renderQuote();
});

/* Responsive navigation */

$("#menuBtn").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

$$(".nav-link").forEach(link => {
  link.addEventListener("click", () => {
    $$(".nav-link").forEach(item => item.classList.remove("active"));
    link.classList.add("active");
    $("#sidebar").classList.remove("open");
  });
});

document.addEventListener("click", event => {
  if (window.innerWidth > 700) return;

  const sidebar = $("#sidebar");
  if (!sidebar.contains(event.target) &&
      !$("#menuBtn").contains(event.target)) {
    sidebar.classList.remove("open");
  }
});

/* Initialize */

$("#taskDate").value = dateKey();
updateGreeting();
applyTheme();
renderTasks();
renderNotes();
renderCalendar();
renderAnalytics();
renderQuote();
updateTimerDisplay();
updateStats();
renderNotificationSettings();
