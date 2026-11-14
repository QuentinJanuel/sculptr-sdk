import type { Block } from "../decompiled-gml";
import type { ModUi } from "../ui";

/**
 * GameMaker version
 *
 * 8.1 and 8.2 are treated as gm8.
 * Studio 1.4 and 2.x are treated as gms.
 */
export type Engine = "gm8" | "gms";

/**
 * The host's language
 */
export type Language =
  | "en"
  | "zh-CN"
  | "ja"
  | "ko"
  | "es"
  | "pt-BR"
  | "de"
  | "fr"
  | "it"
  | "ru"
  | "pl";

/**
 * The object events accessible to a mod.
 */
export type EventName = "create" | "destroy" | "beginStep" | "step" | "endStep" | "draw";

export interface Identity {
  /**
   * Unique across all mods. All mangled names are derived from it.
   */
  id: string;
  version: string;
}

interface HostObject {
  kind: "object";
  name: string;
  events: Partial<Record<EventName, string>>;
  depth?: number;
  persistent?: boolean;
  visible?: boolean;
}

interface HostScript {
  kind: "script";
  name: string;
  source: string;
}

interface HostHook {
  kind: "hook";
  script: string;
  original: string;
  source: string;
}

interface HostInsert {
  kind: "insert";
  /** The statement's opaque token, from `mod.content`. */
  at: string;
  place: "before" | "after" | "instead";
  /** The asset name of a script declared alongside this. */
  call: string;
}

interface HostGameCode {
  scripts: { name: string; body: Block }[];
  objects: { name: string; events: Partial<Record<EventName, Block>> }[];
  events: { name: string; body: Block }[];
  sounds: { name: string; exclusive: boolean }[];
  rooms: { name: string; body: Block; room: string; object: string | null }[];
}

interface HostGml {
  send(expression: string): string;
  receive(variable: string): string;
}

/**
 * The raw API exposed to a mod. You shouldn't need to use this directly.
 */
/**
 * A chosen character. `sheet` is a 128x128 PNG: four 32x32 frames across, four rows down --
 * idle, run, jump, fall, each row repeating its last frame if its animation is shorter.
 *
 * The bytes rather than a URL, so a mod needs no network -- and so it works in the main process,
 * which cannot fetch the app's own scheme.
 */
export interface HostSkin {
  readonly id: string;
  readonly sheet: Uint8Array;
}

export type ControlAction = "up" | "down" | "left" | "right" | "confirm" | "cancel" | "retry";

export const CANONICAL_CONTROL_KEYS: Readonly<Record<ControlAction, string>> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  confirm: "ShiftLeft",
  cancel: "KeyZ",
  retry: "KeyR",
};

/** Every action, in the order the host shows them. */
export const CONTROL_ACTIONS: readonly ControlAction[] = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "cancel",
  "retry",
];

/**
 * What the player bound each action to
 */
export type HostControls = Readonly<Record<ControlAction, readonly string[]>>;

/**
 * Whether a binding is a controller input rather than a key.
 *
 * Controller bindings live in the same list as keys (`PadButton0`, `PadAxis1Plus`, ... -- the
 * Gamepad API's standard-mapping indices). `gameMakerKey` answers `0` for them, so a mod that only
 * deals in keys ignores them for free.
 */
export function isPadBinding(code: string): boolean {
  return /^Pad(?:Button\d{1,2}|Axis\d{1,2}(?:Plus|Minus))$/u.test(code);
}

/** Who is playing. */
export interface HostPlayer {
  readonly account: { readonly id: string; readonly name: string } | null;
  readonly skin: HostSkin | null;
  readonly room: HostRoom | null;
  readonly language: Language;
  readonly controls: HostControls;
}

export interface HostRoom {
  readonly id: string;
}

/**
 * Handing bytes to the game as a file.
 *
 * The host always owns the filesystem the game reads: in the browser both engines share one
 * virtual filesystem that lives in the app, and a native install is a real game reading real files
 * the app put there. So a picture is written, not transmitted.
 */
export interface HostFiles {
  /**
   * Writes the bytes and answers with the path the *game* should open.
   *
   * `at` is the directory the game reported: the string it puts in front of a filename. A host
   * whose filesystem is the game's own composes the path from it, so both sides mean the same file
   * without anyone guessing how that engine resolves a relative name. A host writing a real file
   * somewhere of its own choosing ignores it.
   */
  write(name: string, bytes: Uint8Array, at: string): Promise<string>;
}

export interface HostApi {
  readonly identity: Identity;
  readonly target: { engine: Engine };
  readonly game: HostGameCode;
  getPlayer(): HostPlayer;
  resource: { create(resource: HostObject | HostScript | HostHook | HostInsert): void };
  readonly gml: HostGml;
  readonly files: HostFiles;
  send(message: string): void;
  readonly ui: ModUi;

  // Events
  on(event: "message", handler: (message: string) => void): void;
  on(event: "start", handler: () => void): void;
  on(event: "player", handler: (player: HostPlayer) => void): void;
}
