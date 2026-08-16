const MAX_TITLE_LENGTH = 100;

const ALLOWED_TRANSITIONS = Object.freeze({
  todo: Object.freeze(["in-progress"]),
  "in-progress": Object.freeze(["todo", "done"]),
  done: Object.freeze(["in-progress"]),
});

export class TaskValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TaskValidationError";
  }
}

export class TaskNotFoundError extends Error {
  constructor() {
    super("Task not found.");
    this.name = "TaskNotFoundError";
  }
}

export class TaskTransitionError extends Error {
  constructor(currentStatus, nextStatus) {
    super(`Cannot move a task from ${currentStatus} to ${nextStatus}.`);
    this.name = "TaskTransitionError";
  }
}

export function normalizeTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";

  if (!title) {
    throw new TaskValidationError("Task title is required.");
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw new TaskValidationError(
      "Task title must be 100 characters or fewer.",
    );
  }

  return title;
}

export function addTask(tasks, { id, title }) {
  const normalizedId = typeof id === "string" ? id.trim() : "";

  if (!normalizedId) {
    throw new TaskValidationError("Task ID is required.");
  }

  if (tasks.some((task) => task.id === normalizedId)) {
    throw new TaskValidationError("Task ID already exists.");
  }

  return [
    {
      id: normalizedId,
      title: normalizeTitle(title),
      status: "todo",
    },
    ...tasks,
  ];
}

export function moveTask(tasks, id, nextStatus) {
  const taskIndex = tasks.findIndex((task) => task.id === id);

  if (taskIndex === -1) {
    throw new TaskNotFoundError();
  }

  const task = tasks[taskIndex];
  const allowedNextStatuses = ALLOWED_TRANSITIONS[task.status] ?? [];

  if (!allowedNextStatuses.includes(nextStatus)) {
    throw new TaskTransitionError(task.status, nextStatus);
  }

  return tasks.map((currentTask, index) =>
    index === taskIndex
      ? { ...currentTask, status: nextStatus }
      : currentTask,
  );
}
export function deleteTask(tasks, id) {
  const taskIndex = tasks.findIndex((task) => task.id === id);

  if (taskIndex === -1) {
    throw new TaskNotFoundError();
  }

  return tasks.filter((_, index) => index !== taskIndex);
}
