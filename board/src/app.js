import {
  addTask,
  deleteTask,
  moveTask,
  TaskValidationError,
} from "./tasks.js";
import {
  createTaskStorage,
  TaskStorageError,
} from "./storage.js";

const ACTIONS_BY_STATUS = {
  todo: [
    { action: "move", nextStatus: "in-progress", label: "Start" },
    { action: "delete", label: "Delete", variant: "danger" },
  ],
  "in-progress": [
    { action: "move", nextStatus: "todo", label: "Back", variant: "secondary" },
    { action: "move", nextStatus: "done", label: "Complete" },
    { action: "delete", label: "Delete", variant: "danger" },
  ],
  done: [
    { action: "move", nextStatus: "in-progress", label: "Reopen" },
    { action: "delete", label: "Delete", variant: "danger" },
  ],
};

const form = document.querySelector("#task-form");
const titleInput = document.querySelector("#task-title");
const formMessage = document.querySelector("#form-message");
const appMessage = document.querySelector("#app-message");
const addButton = form.querySelector('button[type="submit"]');
const board = document.querySelector(".board");

const columns = {
  todo: {
    label: "To Do",
    list: document.querySelector("#todo-list"),
  },
  "in-progress": {
    label: "In Progress",
    list: document.querySelector("#in-progress-list"),
  },
  done: {
    label: "Done",
    list: document.querySelector("#done-list"),
  },
};

for (const column of Object.values(columns)) {
  column.count = column.list
    .closest(".column")
    .querySelector(".column-count");
}

const storage = createTaskStorage(window.localStorage);
let tasks = [];
let mutationsDisabled = false;

try {
  tasks = storage.load();
} catch (error) {
  if (!(error instanceof TaskStorageError)) {
    throw error;
  }

  mutationsDisabled = true;
  showAppError(
    `${error.message} Changes are disabled to protect your saved tasks.`,
  );
}

function createActionButton(task, actionDetails) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-action";
  button.disabled = mutationsDisabled;
  button.dataset.action = actionDetails.action;
  button.dataset.taskId = task.id;
  button.textContent = actionDetails.label;
  button.setAttribute(
    "aria-label",
    `${actionDetails.label} ${task.title}`,
  );

  if (actionDetails.nextStatus) {
    button.dataset.nextStatus = actionDetails.nextStatus;
  }

  if (actionDetails.variant) {
    button.classList.add(
      `task-action--${actionDetails.variant}`,
    );
  }

  return button;
}

function createTaskCard(task) {
  const item = document.createElement("li");
  item.className = "task-card";
  item.dataset.taskId = task.id;

  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;

  const actions = document.createElement("div");
  actions.className = "task-actions";

  for (const actionDetails of ACTIONS_BY_STATUS[task.status]) {
    actions.append(createActionButton(task, actionDetails));
  }

  item.append(title, actions);
  return item;
}

function renderColumn(status) {
  const column = columns[status];
  const columnTasks = tasks.filter((task) => task.status === status);

  column.list.replaceChildren();
  column.count.textContent = String(columnTasks.length);
  column.count.setAttribute(
    "aria-label",
    `${columnTasks.length} ${column.label} tasks`,
  );

  if (columnTasks.length === 0) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty-state";
    emptyState.textContent = "No tasks yet.";
    column.list.append(emptyState);
    return;
  }

  column.list.append(
    ...columnTasks.map((task) => createTaskCard(task)),
  );
}

function render() {
  for (const status of Object.keys(columns)) {
    renderColumn(status);
  }
}

function showFormMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.classList.toggle(
    "form-message--success",
    Boolean(message) && !isError,
  );
}
function showAppError(message) {
  appMessage.textContent = message;
  appMessage.hidden = false;
}

function clearAppError() {
  appMessage.textContent = "";
  appMessage.hidden = true;
}

function setMutationsDisabled(disabled) {
  titleInput.disabled = disabled;
  addButton.disabled = disabled;

  for (const button of board.querySelectorAll(".task-action")) {
    button.disabled = disabled;
  }
}

function commitTasks(candidateTasks) {
  try {
    storage.save(candidateTasks);
  } catch (error) {
    if (!(error instanceof TaskStorageError)) {
      throw error;
    }

    showAppError(
      `${error.message} Your previous board is unchanged.`,
    );
    return false;
  }

  clearAppError();
  tasks = candidateTasks;
  render();
  return true;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  titleInput.removeAttribute("aria-invalid");
  showFormMessage("");

  let candidateTasks;

  try {
    candidateTasks = addTask(tasks, {
      id: crypto.randomUUID(),
      title: titleInput.value,
    });
  } catch (error) {
    if (error instanceof TaskValidationError) {
      titleInput.setAttribute("aria-invalid", "true");
      showFormMessage(error.message, true);
      titleInput.focus();
      return;
    }

    throw error;
  }

  if (!commitTasks(candidateTasks)) {
    titleInput.focus();
    return;
  }

  titleInput.value = "";
  showFormMessage("Task added.");
  titleInput.focus();
});

board.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest(".task-action");

  if (!button) {
    return;
  }

  const { action, taskId, nextStatus } = button.dataset;
  const task = tasks.find((currentTask) => currentTask.id === taskId);

  if (!task) {
    throw new Error("Task action referenced a missing task.");
  }

  let candidateTasks;
  let successMessage;

  if (action === "move") {
    candidateTasks = moveTask(tasks, taskId, nextStatus);
    successMessage = "Task moved.";
  } else if (action === "delete") {
    const confirmed = window.confirm(`Delete "${task.title}"?`);

    if (!confirmed) {
      return;
    }

    candidateTasks = deleteTask(tasks, taskId);
    successMessage = "Task deleted.";
  } else {
    throw new Error(`Unsupported task action: ${action}`);
  }

  if (!commitTasks(candidateTasks)) {
    return;
  }

  showFormMessage(successMessage);
});

render();
setMutationsDisabled(mutationsDisabled);