import {
  normalizeTitle,
  TaskValidationError,
} from "./tasks.js";

const STORAGE_KEY = "personal-task-board:v1";
const STORAGE_VERSION = 1;
const VALID_STATUSES = new Set(["todo", "in-progress", "done"]);

export class TaskStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "TaskStorageError";
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidTask(task) {
  if (
    !isRecord(task) ||
    typeof task.id !== "string" ||
    !task.id.trim() ||
    typeof task.title !== "string" ||
    !VALID_STATUSES.has(task.status)
  ) {
    return false;
  }

  try {
    return normalizeTitle(task.title) === task.title;
  } catch (error) {
    if (error instanceof TaskValidationError) {
      return false;
    }

    throw error;
  }
}

function validateTasks(tasks, label) {
  if (!Array.isArray(tasks)) {
    throw new TaskStorageError(
      `${label} has an invalid format.`,
    );
  }

  if (!tasks.every(isValidTask)) {
    throw new TaskStorageError(
      `${label} contains an invalid task.`,
    );
  }

  const taskIds = tasks.map((task) => task.id);

  if (new Set(taskIds).size !== taskIds.length) {
    throw new TaskStorageError(
      `${label} contains duplicate task IDs.`,
    );
  }

  return tasks;
}

function validateDocument(document) {
  if (
    !isRecord(document) ||
    !Object.hasOwn(document, "version") ||
    !Object.hasOwn(document, "tasks")
  ) {
    throw new TaskStorageError(
      "Saved task data has an invalid format.",
    );
  }

  if (document.version !== STORAGE_VERSION) {
    throw new TaskStorageError(
      "Saved task data uses an unsupported version.",
    );
  }

  return validateTasks(document.tasks, "Saved task data");
}

function parseDocument(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    throw new TaskStorageError(
      "Saved task data is not valid JSON.",
      error,
    );
  }
}

export function createTaskStorage(storage) {
  return {
    load() {
      let value;

      try {
        value = storage.getItem(STORAGE_KEY);
      } catch (error) {
        throw new TaskStorageError(
          "Saved task data could not be read.",
          error,
        );
      }

      if (value === null) {
        return [];
      }

      return validateDocument(parseDocument(value));
    },

    save(tasks) {
      validateTasks(tasks, "Task data to save");

      try {
        const value = JSON.stringify({
          version: STORAGE_VERSION,
          tasks,
        });

        storage.setItem(STORAGE_KEY, value);
      } catch (error) {
        throw new TaskStorageError(
          "Task data could not be saved.",
          error,
        );
      }
    },
  };
}
