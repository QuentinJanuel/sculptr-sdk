export const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/u;
export const VAR_NAME = /^[A-Za-z][A-Za-z0-9_]*$/u;
export const SCRATCH_NAME = /^[A-Za-z0-9_.-]+$/u;

export type EventHandler = (payload: string) => void | Promise<void>;
