/**
 * Types for representing decompiled GML code.
 * Useful for detecting patterns in a game (e.g. identify the "killPlayer" script, etc.)
 */

/**
 * A GML block (list of statements), lossy.
 */
export type Block = Stmt[];

/**
 * Where a statement is, opaquely. Only good for `mod.resource.script.insert`, and only for the game
 * and launch it came from, so never persist one.
 */
export type At = string & { readonly __at: unique symbol };

/**
 * A GML statement, lossy.
 *
 * `at` is absent when the engine could not place the statement (a `for` header's parts, a
 * decompiler's temporary); inserting at one is refused.
 */
export type Stmt =
  | {
      k: "assign";
      at?: At;
      target: Expr;
      op: "=" | "+=" | "-=" | "*=" | "/=" | "other";
      value: Expr;
    }
  | { k: "call"; at?: At; call: CallExpr }
  | { k: "if"; at?: At; cond: Expr; then: Block; else: Block }
  | { k: "with"; at?: At; target: Expr; body: Block }
  /**
   * Any loop
   */
  | { k: "loop"; at?: At; body: Block }
  | { k: "switch"; at?: At; value: Expr; bodies: Block[] }
  | { k: "exit"; at?: At; value: Expr | null }
  /**
   * Anything not modelled here: `break`, `continue`, a `case` label.
   */
  | { k: "unknown"; at?: At };

/**
 * Every statement in a block, in source order, descending into branches, bodies and cases:
 * ```ts
 * for (const stmt of walk(script.body)) {
 *   if (stmt.k === "call" && stmt.call.name === "instance_destroy") ...
 * }
 * ```
 */
export function* walk(block: Block): Generator<Stmt> {
  for (const stmt of block) {
    yield stmt;
    switch (stmt.k) {
      case "if":
        yield* walk(stmt.then);
        yield* walk(stmt.else);
        break;
      case "with":
      case "loop":
        yield* walk(stmt.body);
        break;
      case "switch":
        for (const body of stmt.bodies) yield* walk(body);
        break;
      default:
        break;
    }
  }
}

export type Expr =
  | { k: "number"; value: number }
  | { k: "string"; value: string }
  | { k: "constant"; name: string }
  | { k: "asset"; kind: "object" | "script" | "sprite" | "room" | "sound" | "other"; name: string }
  | { k: "var"; scope: "local" | "self" | "global" | "builtin"; name: string }
  | { k: "field"; of: Expr; name: string }
  | { k: "index"; of: Expr; at: Expr[] }
  | { k: "arg"; index: number | null }
  | CallExpr
  | { k: "op"; op: string; args: Expr[] }
  | { k: "unknown" };

export interface CallExpr {
  k: "call";
  kind: "script" | "builtin";
  name: string;
  args: Expr[];
}
