import type { Block, Expr } from "../decompiled-gml";
import type { EventName } from "../host";

export interface ScriptContent {
  readonly name: string;
  readonly body: Block;
}

export interface ObjectContent {
  readonly name: string;
  /** The events the object declares itself, among the six a mod object can have. The same code is
   *  in `GameContent.events` under the engine's own name for the event. */
  readonly events: Partial<Record<EventName, Block>>;
}

/** One piece of the game's code, named so a mod can say which one it means. */
export interface CodeContent {
  /**
   * How the engine names this piece of code -- `world.KeyPress_82`, `player.Collision_17`,
   * `boss.Alarm_0` on GameMaker 8. Engine-specific on purpose: a name the engine itself uses is
   * one you can find again in the IDE.
   *
   * For room code (`RoomCodeContent`) it is `<room>.room` or `<room>.instance_<id>`.
   */
  readonly name: string;
  readonly body: Block;
}

/** one piece of code a room runs when it loads */
export interface RoomCodeContent extends CodeContent {
  /** the room whose load runs this */
  readonly room: string;
  /** the object of the instance this is the creation code of */
  readonly object: string | null;
}

/** Game sound asset */
export interface SoundContent {
  readonly name: string;
  /** Whether playing this sound stops whatever else was playing. */
  readonly exclusive: boolean;
}

/**
 * Game resources. Lossy. Useful for detecting patterns.
 */
export interface GameContent {
  readonly scripts: readonly ScriptContent[];
  readonly objects: readonly ObjectContent[];
  /** every event every object declares, flat, as addressable code */
  readonly events: readonly CodeContent[];
  /** the game's sound assets */
  readonly sounds: readonly SoundContent[];
  /** a room's own creation code, and the creation code of each instance placed in it */
  readonly rooms: readonly RoomCodeContent[];
}

/**
 * The highest constant argument index a piece of the game's code reads, or -1 for none.
 */
export const highestArgument = function (block: Block): number {
  let highest = -1;
  const expr = (e: Expr): void => {
    switch (e.k) {
      case "arg":
        if (e.index !== null && e.index < 16) highest = Math.max(highest, e.index);
        break;
      case "field":
        expr(e.of);
        break;
      case "index":
        expr(e.of);
        e.at.forEach(expr);
        break;
      case "op":
        e.args.forEach(expr);
        break;
      case "call":
        e.args.forEach(expr);
        break;
      default:
        break;
    }
  };
  const statements = (b: Block): void => {
    for (const s of b) {
      if (s.k === "assign") {
        expr(s.target);
        expr(s.value);
      } else if (s.k === "call") expr(s.call);
      else if (s.k === "if") {
        expr(s.cond);
        statements(s.then);
        statements(s.else);
      } else if (s.k === "with") {
        expr(s.target);
        statements(s.body);
      } else if (s.k === "loop") statements(s.body);
      else if (s.k === "switch") {
        expr(s.value);
        s.bodies.forEach(statements);
      } else if (s.k === "exit" && s.value) expr(s.value);
    }
  };
  statements(block);
  return highest;
};
