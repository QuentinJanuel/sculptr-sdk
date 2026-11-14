import type { GameContent } from "./content";
import type { Engine, HostApi, HostPlayer } from "./host";
import {
  type ObjectActions,
  type ObjectContext,
  type ObjectSpec,
  type ObjectVars,
  registerObjects,
} from "./resources/object";
import {
  type Hook,
  type Insert,
  insertToken,
  registerHooks,
  registerInserts,
  type ScriptActions,
  type ScriptSpec,
  registerScripts,
} from "./resources/script";
import {
  type DeclaredSprite,
  getSpriteLoader,
  registerSpriteHandlers,
  registerSprites,
  type SpriteActions,
  type SpriteSource,
  spriteInboxCreate,
} from "./resources/sprite";
import type { ModUi } from "./ui";
import { EVENT_NAME, type EventHandler, SCRATCH_NAME, VAR_NAME } from "./utils";

export type {
  ControlAction,
  Engine,
  EventName,
  HostApi,
  HostControls,
  HostPlayer,
  HostRoom,
  HostSkin,
  Identity,
  Language,
} from "./host";
export { CANONICAL_CONTROL_KEYS, CONTROL_ACTIONS, isPadBinding } from "./host";
export type { ImageRect, ImageSize } from "./image";
export { pngSize, sliceImage } from "./image";
export type {
  CodeContent,
  GameContent,
  ObjectContent,
  RoomCodeContent,
  ScriptContent,
  SoundContent,
} from "./content";
export { highestArgument } from "./content";
export type { At, Block, CallExpr, Expr, Stmt } from "./decompiled-gml";
export { walk } from "./decompiled-gml";
export type {
  ObjectContext,
  ObjectGml,
  ObjectReceiveContext,
  ObjectReceiveGml,
  ObjectSpec,
  ObjectVars,
} from "./resources/object";
export type {
  HookContext,
  HookWrap,
  InsertContext,
  InsertSpec,
  OriginalScript,
  ScriptContext,
  ScriptSpec,
} from "./resources/script";
export type { Sprite, SpriteOptions, SpriteSize, SpriteSource } from "./resources/sprite";
export type { EventHandler } from "./utils";
export { gameMakerKey } from "./keyboard";
export type {
  Bindable,
  ModUi,
  ReadonlyRef,
  Ref,
  UiAlign,
  UiBuilder,
  UiButtonOptions,
  UiColOptions,
  UiEachOptions,
  UiGap,
  UiInputOptions,
  UiKeybindOptions,
  UiNodeSpec,
  UiRowOptions,
  UiScrollOptions,
  UiSectionOptions,
  UiSelectOption,
  UiSelectOptions,
  UiSpec,
  UiStateOptions,
  UiTextOptions,
  UiToggleOptions,
  UiTone,
  UiVariant,
} from "./ui";

export interface Mod {
  engine: Engine;
  /**
   * Who is playing, the character they chose, and the language the host is in. The first two are
   * null when signed out; `skin` is also null when they never picked one, and `language` is always
   * set.
   *
   * A function because it can change while the game runs, so read it again rather than keeping the
   * result. During the mod's setup it is pinned -- on a native install that setup runs twice, once
   * to bake the GML and once to run this JavaScript, and a mod whose resources depended on a live
   * value could declare two different things.
   */
  getPlayer: () => HostPlayer;
  /**
   * The player signed in or out, picked a different character, or changed the host's language.
   * Never during setup, so what a mod declares cannot depend on it -- only what it does with what
   * it declared.
   */
  onPlayerChange(handler: (player: HostPlayer) => void): void;
  /**
   * Existing game content. Useful for detecting patterns.
   */
  content: GameContent;
  /**
   * Manipulate the game resources.
   */
  resource: {
    object: ObjectActions;
    script: ScriptActions;
    sprite: SpriteActions;
  };
  /**
   * A path for a scratch file as a GML expression.
   * Not deleted automatically, so delete it once you're done.
   */
  scratchPath(name: string): string;
  /**
   * A call to one of this mod's own scripts, as GML.
   *
   * The same thing an event's context hands you, available without one -- which is what lets a
   * library built on top of this declare scripts and then write calls to them without every one of
   * its functions taking a context it does not otherwise need.
   */
  call(script: string, ...args: string[]): string;
  /**
   * Called once the game is running and can hear this mod.
   */
  onStart(handler: () => void): void;
  /**
   * Receive an event from GML to JS.
   */
  on(event: string, handler: EventHandler): void;
  /**
   * Send an event from JS to GML.
   */
  send(event: string, payload?: string): void;
  /**
   * This mod's own panel, shown beside the game while it runs.
   *
   * Where a mod's settings live. Rather than the host growing a checkbox for every mod that needs
   * one -- which it cannot do at all for a mod it does not ship -- the mod brings its own UI and the
   * app renders it without knowing what any of it means. See `ModUi`.
   */
  ui: ModUi;
}

export interface ModDefinition {
  activate: (api: HostApi) => void;
}

const prefixFor = function (id: string): string {
  const readable = (id.split(/[/.]/u).pop() ?? id).replaceAll(/[^A-Za-z0-9]/gu, "").slice(0, 12);
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  const short = ((hash >>> 0) % 0x10000).toString(16).padStart(4, "0");
  return `m${readable}_${short}_`;
};

/**
 * Entry point for creating a mod
 */
export const createMod = function (init: (mod: Mod) => void): ModDefinition {
  return {
    activate(api) {
      const identity = api.identity;
      const prefix = prefixFor(identity.id);
      const objects: ObjectSpec<string>[] = [];
      const scripts: ScriptSpec<string>[] = [];
      const sprites: DeclaredSprite[] = [];
      const hooks: Hook[] = [];
      const inserts: Insert[] = [];
      const handlers = new Map<string, EventHandler[]>();
      let declaring = true;

      const normalizeEventName = (eventName: string): string => {
        if (!EVENT_NAME.test(eventName)) {
          throw new Error(
            `mod ${identity.id}: ${JSON.stringify(eventName)} is not a usable event name ` +
              `(letters, digits, - and _, starting with a letter)`,
          );
        }
        return eventName.replaceAll("-", "_");
      };

      const scratch = (name: string): string => `${prefix}__${name}`;
      const varsOf = (spec: ObjectSpec<string>): ObjectVars<string> => {
        const declared: Record<string, string> = {};
        for (const name of spec.vars ?? []) {
          if (!VAR_NAME.test(name)) {
            throw new Error(
              `mod ${identity.id}: ${JSON.stringify(name)} is not a usable variable name ` +
                `(letters, digits and _, starting with a letter)`,
            );
          }
          declared[name] = `${prefix}v_${name}`;
        }
        return declared;
      };
      const queue = (event: string): string => `global.${prefix}q_${event}`;

      const sendInternal = (event: string, payload = "") => api.send(`${event} ${payload}`);
      const sendInternalGml = (event: string, expression?: string) =>
        api.gml.send(expression ? `"${event} " + (${expression})` : `"${event} "`);
      const send = (event: string, expression?: string) =>
        sendInternalGml(normalizeEventName(event), expression);
      const call = (script: string, ...args: string[]) => {
        if (!scripts.some((declared) => declared.name === script)) {
          throw new Error(
            `mod ${identity.id}: call(${JSON.stringify(script)}) names a script this mod ` +
              `never declared. It has: ${scripts.map((one) => one.name).join(", ") || "none"}`,
          );
        }
        return `${prefix}s_${script}(${args.join(", ")})`;
      };
      const objContext = (spec: ObjectSpec<string>): ObjectContext<string> => ({
        engine: api.target.engine,
        v: varsOf(spec),
        send,
        call,
      });
      const spriteLoader = getSpriteLoader({
        hostApi: api,
        identity,
        sendInternal,
      });

      const shown = new Map<string, SpriteSource[]>();

      const content: GameContent = api.game;

      const mod: Mod = {
        engine: api.target.engine,
        call,
        // Passed straight through: the loader owns the reactivity and the panel, and a wrapper here
        // could only add a second place for the two to disagree about what a mod declared.
        ui: api.ui,
        getPlayer: () => api.getPlayer(),
        onPlayerChange: (handler) => api.on("player", handler),
        content,
        resource: {
          object: {
            create(spec) {
              if (!declaring) {
                throw new Error(
                  `mod ${identity.id}: objects can only be declared while the mod is built`,
                );
              }
              objects.push(spec);
            },
          },
          script: {
            create(spec) {
              if (!declaring) {
                throw new Error(
                  `mod ${identity.id}: scripts can only be declared while the mod is built`,
                );
              }
              if (!VAR_NAME.test(spec.name)) {
                throw new Error(
                  `mod ${identity.id}: ${JSON.stringify(spec.name)} is not a usable script name ` +
                    `(letters, digits and _, starting with a letter)`,
                );
              }
              if (scripts.some((declared) => declared.name === spec.name)) {
                throw new Error(
                  `mod ${identity.id}: two scripts are called ${JSON.stringify(spec.name)}`,
                );
              }
              scripts.push(spec);
            },
            hook(name, wrap) {
              if (!declaring) {
                throw new Error(
                  `mod ${identity.id}: hooks can only be declared while the mod is built`,
                );
              }
              hooks.push({ script: name, wrap });
            },
            insert(spec) {
              if (!declaring) {
                throw new Error(
                  `mod ${identity.id}: insertions can only be declared while the mod is built`,
                );
              }
              inserts.push({
                at: insertToken(identity.id, spec),
                place: spec.place,
                body: spec.body,
              });
            },
          },
          sprite: {
            create(name, options = {}) {
              if (!declaring) {
                throw new Error(
                  `mod ${identity.id}: sprites can only be declared while the mod is built`,
                );
              }
              if (!VAR_NAME.test(name)) {
                throw new Error(
                  `mod ${identity.id}: ${JSON.stringify(name)} is not a usable sprite name ` +
                    `(letters, digits and _, starting with a letter)`,
                );
              }
              if (sprites.some((declared) => declared.name === name)) {
                throw new Error(
                  `mod ${identity.id}: two sprites are called ${JSON.stringify(name)}`,
                );
              }
              sprites.push({ name, options });
              return {
                id: `global.${prefix}spr_${name}`,
                load: (source) => {
                  shown.set(name, source);
                  return spriteLoader.loadSprite(name, options, source);
                },
              };
            },
          },
        },
        on(event, handler) {
          const name = normalizeEventName(event);
          const existing = handlers.get(name);
          if (existing) existing.push(handler);
          else handlers.set(name, [handler]);
        },

        onStart(handler) {
          api.on("start", handler);
        },

        scratchPath(name) {
          if (!SCRATCH_NAME.test(name)) {
            throw new Error(
              `mod ${identity.id}: ${JSON.stringify(name)} is not a usable scratch file name ` +
                `(letters, digits, _ . and -)`,
            );
          }
          return api.target.engine === "gm8"
            ? `temp_directory + "\\${prefix}${name}"`
            : `"${prefix}${name}"`;
        },

        send(event, payload = "") {
          api.send(`${normalizeEventName(event)} ${payload}`);
        },
      };

      init(mod);
      declaring = false;

      registerInserts({
        identity,
        inserts,
        prefix,
        hostApi: api,
        send,
        call,
      });

      registerScripts({
        identity,
        scripts,
        hostApi: api,
        prefix,
        send,
        call,
      });

      registerHooks({
        identity,
        hooks,
        content,
        hostApi: api,
        prefix,
        send,
        call,
      });

      registerObjects({
        identity,
        hostApi: api,
        prefix,
        objects,
        internalReceive: registerSprites({
          hostApi: api,
          prefix,
          sprites,
          payload: scratch("pl"),
          sendInternalGml,
        }),
        internalCreate: spriteInboxCreate({
          engine: api.target.engine,
          prefix,
          sprites,
          sendInternalGml,
        }),
        normalizeEventName,
        context: objContext,
        queue,
        scratch,
      });
      registerSpriteHandlers({ identity, sprites, shown, spriteLoader, handlers });

      api.on("message", (message) => {
        const at = message.indexOf(" ");
        const event = at < 0 ? message : message.slice(0, at);
        const payload = at < 0 ? "" : message.slice(at + 1);
        const listening = handlers.get(event);
        if (!listening) return;
        for (const handler of listening) {
          void new Promise((resolve) => {
            resolve(handler(payload));
          }).catch((error: unknown) => {
            console.error(`[${identity.id}] handling ${event} failed:`, error);
          });
        }
      });
    },
  };
};
