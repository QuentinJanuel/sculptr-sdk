import { type GameContent, highestArgument } from "../content";
import type { At, Stmt } from "../decompiled-gml";
import type { Engine, HostApi, Identity } from "../host";
import { VAR_NAME } from "../utils";

/**
 * What is given to help create the GML block.
 */
export interface ScriptContext<Arg extends string> {
  engine: Engine;
  /** This script's arguments, by the names it declared: `a.value` is `argument0`. */
  a: Record<Arg, string>;
  /**
   * Sends an event to JavaScript:
   * ```ts
   * mod.resource.script.create({
   *   name: "myScript",
   *   body: ({ send }) => send("ping", `"Hello from GML"`),
   * });
   * ```
   */
  send(event: string, expression?: string): string;
  /**
   * Calls a script you previously defined:
   * ```ts
   * mod.resource.script.create({
   *   name: "myScript",
   *   body: ({ call }) => `return ${call("myOtherScript", "1")};`,
   * });
   * ```
   */
  call(script: string, ...args: string[]): string;
}

export interface ScriptSpec<Arg extends string> {
  /**
   * The script name can be simple as it will be mangled.
   */
  name: string;
  /**
   * Script argument names:
   * ```ts
   * mod.resource.script.create({
   *   name: "sum",
   *   args: ["x", "y"],
   *   body: ({ a }) => `return ${a.x} + ${a.y};`,
   * });
   * ```
   */
  args?: readonly Arg[];
  body: (context: ScriptContext<Arg>) => string;
}

/**
 * The script a hook replaced.
 */
export interface OriginalScript {
  /**
   * Calls the original. With no arguments it forwards the ones this call received.
   */
  call(...args: string[]): string;
  /**
   * Argument `index` of this call, as GML.
   */
  arg(index: number): string;
  /**
   * How many arguments this call received, as GML.
   */
  readonly argumentCount: string;
}

/**
 * Same as @see ScriptContext but with the original instead of the arguments.
 */
export interface HookContext {
  engine: Engine;
  original: OriginalScript;
  send(event: string, expression?: string): string;
  call(script: string, ...args: string[]): string;
}

/**
 * GML factory for a hook
 */
export type HookWrap = (context: HookContext) => string;

/**
 * Same as @see HookContext but with no original: an insertion runs beside the game's code, not
 * instead of it.
 */
export interface InsertContext {
  engine: Engine;
  send(event: string, expression?: string): string;
  call(script: string, ...args: string[]): string;
}

export interface InsertSpec {
  /**
   * The statement to run around, from `mod.content`. One the engine could not place is refused.
   */
  at: Stmt;
  /**
   * `"before"` it starts, or `"after"` it finishes -- once, on every way out of it. For a loop that
   * is once when the loop ends; point at the last statement of its body to run per iteration.
   *
   * `"instead"` replaces it: the body runs and the statement does not.
   */
  place: "before" | "after" | "instead";
  /**
   * The GML to run there.
   */
  body: (context: InsertContext) => string;
}

export interface Hook {
  script: string;
  wrap: HookWrap;
}

export const registerHooks = function (data: {
  identity: Identity;
  hooks: Hook[];
  content: GameContent;
  prefix: string;
  hostApi: HostApi;
  send(event: string, expression?: string | undefined): string;
  call(script: string, ...args: string[]): string;
}) {
  data.hooks.forEach(({ script, wrap }, index) => {
    const original = `${data.prefix}__orig${index}_${script}`;
    const body = data.content.scripts.find((candidate) => candidate.name === script)?.body ?? [];
    const mentioned = highestArgument(body) + 1;
    const forward = `${data.prefix}__fwd${index}`;
    const count = `global.${data.prefix}__hc${index}`;
    const saved = `global.${data.prefix}__ha${index}`;
    const cursor = `global.${data.prefix}__hi${index}`;

    const cases = Array.from({ length: 17 }, (_, arity) => {
      const args = Array.from({ length: arity }, (_, at) => `${saved}[${at}]`).join(", ");
      return `  case ${arity}: return ${original}(${args});`;
    }).join("\n");
    data.hostApi.resource.create({
      kind: "script",
      name: forward,
      source: `switch (${count}) {\n${cases}\n}\nreturn 0;`,
    });

    const hookBody = wrap({
      engine: data.hostApi.target.engine,
      original: {
        call: (...args) => (args.length === 0 ? `${forward}()` : `${original}(${args.join(", ")})`),
        arg: (at) => (at >= 0 && at < 16 ? `argument${at}` : `argument[${at}]`),
        argumentCount: "argument_count",
      },
      send: data.send,
      call: data.call,
    });
    data.hostApi.resource.create({
      kind: "hook",
      script,
      original,
      source: `
        ${count} = argument_count;
        ${cursor} = 0;
        while (${cursor} < argument_count) {
          ${saved}[${cursor}] = argument[${cursor}];
          ${cursor} += 1;
        }
        ${
          mentioned > 0
            ? // Never runs: a real GM8.1 runner refuses calls with more arguments than the script names.
              `if (0) { ${saved}[${mentioned - 1}] = argument${mentioned - 1}; }\n`
            : ""
        }${hookBody}`,
    });
  });
};

export interface Insert {
  at: At;
  place: "before" | "after" | "instead";
  body: (context: InsertContext) => string;
}

/**
 * A statement in a few words, to name it in an error. Never GML: the AST cannot be printed back.
 */
function describe(stmt: Stmt): string {
  switch (stmt.k) {
    case "assign":
      return stmt.target.k === "var" ? `an assignment to ${stmt.target.name}` : "an assignment";
    case "call":
      return `a call to ${stmt.call.name}`;
    case "exit":
      return stmt.value ? "a return" : "an exit";
    default:
      return `a ${stmt.k} statement`;
  }
}

/**
 * The statement's token, refusing what only this side can see. The host checks the token, and the
 * engine checks the address.
 */
export function insertToken(modId: string, spec: InsertSpec): At {
  const at = spec.at.at;
  if (at === undefined) {
    throw new Error(
      `mod ${modId}: cannot insert at ${describe(spec.at)} -- this game's engine could not place ` +
        `it, so there is nothing to insert around. Statements without a place include the parts ` +
        `of a \`for\` header and temporaries a decompiler invented.`,
    );
  }
  if (spec.place !== "before" && spec.place !== "after" && spec.place !== "instead") {
    throw new Error(
      `mod ${modId}: an insertion's place is "before", "after" or "instead", not ${JSON.stringify(
        spec.place,
      )}`,
    );
  }
  // Nothing in the script runs once it has left.
  if (spec.place === "after" && spec.at.k === "exit") {
    throw new Error(
      `mod ${modId}: nothing follows ${describe(spec.at)}, so there is no "after" to insert at. ` +
        `Use "before" to run something on the way out.`,
    );
  }
  return at;
}

/**
 * Declares each body as a script, then the insertion calling it. Scripts first, so the call resolves.
 */
export const registerInserts = function (data: {
  identity: Identity;
  inserts: Insert[];
  prefix: string;
  hostApi: HostApi;
  send(event: string, expression?: string): string;
  call(script: string, ...args: string[]): string;
}) {
  // Identical bodies share one script: a mod pointing at a dozen lines usually writes one body.
  const byBody = new Map<string, string>();
  for (const insert of data.inserts) {
    const source = insert.body({
      engine: data.hostApi.target.engine,
      send: data.send,
      call: data.call,
    });
    let name = byBody.get(source);
    if (name === undefined) {
      name = `${data.prefix}__ins${byBody.size}`;
      byBody.set(source, name);
      data.hostApi.resource.create({ kind: "script", name, source });
    }
    data.hostApi.resource.create({
      kind: "insert",
      at: insert.at,
      place: insert.place,
      call: name,
    });
  }
};

export interface ScriptActions {
  /**
   * Creates a new script.
   */
  create<const Arg extends string = never>(spec: ScriptSpec<Arg>): void;
  /**
   * Replaces one of the game's scripts, keeping the original callable:
   * ```ts
   * mod.resource.script.hook("saveExe", ({ original, call }) => `
   *   var result = ${original.call()};
   *   ${call("afterLoad")};
   *   return result;
   * `);
   * ```
   *
   * Only the game's own scripts: an object event has no caller to wrap.
   */
  hook(name: string, wrap: HookWrap): void;
  /**
   * Runs GML at one statement inside the game's code -- or in place of it -- leaving the rest
   * alone:
   * ```ts
   * mod.resource.script.insert({
   *   at: statement,
   *   place: "after",
   *   body: ({ send }) => send("saved", "string(room)"),
   * });
   * ```
   *
   * The body sees `self`, `other`, globals and builtins, but not the host script's `var` locals or
   * its `argument0...`. Several insertions at one statement run in declaration order.
   *
   * Statements of the game's scripts and of its object events (`mod.content.events`). A statement
   * the engine could not place carries no `at` and is refused here, by name.
   */
  insert(spec: InsertSpec): void;
}

export const registerScripts = function (data: {
  identity: Identity;
  scripts: ScriptSpec<string>[];
  prefix: string;
  hostApi: HostApi;
  send(event: string, expression?: string | undefined): string;
  call(script: string, ...args: string[]): string;
}) {
  for (const spec of data.scripts) {
    const args: Record<string, string> = {};
    (spec.args ?? []).forEach((name, index) => {
      if (!VAR_NAME.test(name)) {
        throw new Error(
          `mod ${data.identity.id}: script ${JSON.stringify(spec.name)} has an argument called ` +
            `${JSON.stringify(name)}, which is not a usable name`,
        );
      }
      args[name] = `argument${index}`;
    });
    data.hostApi.resource.create({
      kind: "script",
      name: `${data.prefix}s_${spec.name}`,
      source: spec.body({
        engine: data.hostApi.target.engine,
        a: args,
        send: data.send,
        call: data.call,
      }),
    });
  }
};
