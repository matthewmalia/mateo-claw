/**
 * File-based persistence. Tasks live as `tasks/<id>.json`, run records
 * as `runs/YYYY-MM-DD/<taskId>-<timestamp>.json`. Plain JSON files mean
 * everything is diffable in Git and editable in any text editor.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { TASKS_DIR, RUNS_DIR } from './config.js';
import { validateTaskPolicy } from './policy.js';
import type { Task, RunRecord } from './types.js';

/** Read all tasks from the tasks/ directory. */
export async function loadTasks(): Promise<Task[]> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  const entries = await fs.readdir(TASKS_DIR);
  const tasks: Task[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(TASKS_DIR, entry);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const task = JSON.parse(raw) as Task;
      validateTaskPolicy(task.policy, task.id ?? entry);
      tasks.push(task);
    } catch (err) {
      console.error(`[storage] failed to load ${entry}:`, err);
    }
  }
  return tasks;
}

/** Load a single task by id. Returns null if not found. */
export async function loadTask(id: string): Promise<Task | null> {
  const filePath = path.join(TASKS_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const task = JSON.parse(raw) as Task;
    validateTaskPolicy(task.policy, task.id ?? id);
    return task;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[storage] failed to load task ${id}:`, err);
    }
    return null;
  }
}

/** Persist a task back to disk. */
export async function saveTask(task: Task): Promise<void> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  const filePath = path.join(TASKS_DIR, `${task.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(task, null, 2) + '\n');
}

/** Write a run record to runs/YYYY-MM-DD/<taskId>-<timestamp>.json. */
export async function saveRunRecord(record: RunRecord): Promise<void> {
  const date = record.startedAt.slice(0, 10);
  const dir = path.join(RUNS_DIR, date);
  await fs.mkdir(dir, { recursive: true });
  const safeStart = record.startedAt.replace(/[:.]/g, '-');
  const filePath = path.join(dir, `${record.taskId}-${safeStart}.json`);
  await fs.writeFile(filePath, JSON.stringify(record, null, 2) + '\n');
}
