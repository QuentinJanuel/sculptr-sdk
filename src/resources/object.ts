import type { Engine, EventName, HostApi, Identity } from "../host";

/**
 * The added GML variables.
 */
export type ObjectVars<Name extends string> = Record<Name, string>;

/**
 * What is given to help create a GML block.
 */
export interface ObjectContext<Name extends string> {
  /**
   * Useful if your code needs to differ by GM version
   */
  engine: Engine;
  /**
   * List of modded vars for this GML
   */
  v: ObjectVars<Name>;
  /**
   * Sends an event to JavaScript:
   * ```ts
   * mod.resource.object.create({
   *   name: "myObject",
   *   events: {
   *     create: ({ send }) => send("ping", `"Hello from GML"`),
   *   },
   * });
   * ```
   */
  send(event: string, expression?: string): string;
  /**
   * Calls a script you previously defined:
   * ```ts
   * mod.resource.script.create({
   *   name: "myScript",
   *   // ...
   * });
   * mod.resource.object.create({
   *   name: "myObject",
   *   events: {
   *     create: ({ call }) => `${call("myScript", "1")};`,
   *   },
   * });
   * ```
   */
  call(script: string, ...args: string[]): string;
}

/**
 * Same as @see ObjectContext but with the extra receive payload
 */
export interface ObjectReceiveContext<Name extends string> extends ObjectContext<Name> {
  /**
   * The GML variable holding this message's payload.
   */
  payload: string;
}

/**
 * GML factory
 */
export type ObjectGml<Name extends string> = (context: ObjectContext<Name>) => string;
/**
 * GML factory for a receive event
 */
export type ObjectReceiveGml<Name extends string> = (context: ObjectReceiveContext<Name>) => string;

export interface ObjectSpec<Name extends string> {
  /**
   * The object name can be simple as it will be mangled.
   */
  name: string;
  vars?: readonly Name[];
  events?: Partial<Record<EventName, ObjectGml<Name>>>;
  /**
   * GML to run when a given event is received:
   * ```ts
   * mod.resource.object.create({
   *   name: "myObject",
   *   receive: {
   *     pong: ({ payload }) => `show_message(${payload});`,
   *   },
   * });
   * ```
   */
  receive?: Record<string, ObjectReceiveGml<Name>>;
  depth?: number;
  persistent?: boolean;
  visible?: boolean;
}

export interface ObjectActions {
  /**
   * Creates a new object.
   */
  create<const Name extends string = never>(spec: ObjectSpec<Name>): void;
}

/**
 * Installs the mod's objects, plus the inbox object that sorts incoming events into queues.
 */
export const registerObjects = function (data: {
  identity: Identity;
  hostApi: HostApi;
  prefix: string;
  objects: ObjectSpec<string>[];
  /** GML the inbox runs for each of the library's own events. */
  internalReceive: Record<string, string>;
  /** GML appended to the inbox's Create. */
  internalCreate: string;
  normalizeEventName: (event: string) => string;
  context: (spec: ObjectSpec<string>) => ObjectContext<string>;
  queue: (event: string) => string;
  scratch: (name: string) => string;
}) {
  const {
    identity,
    hostApi,
    prefix,
    objects,
    internalReceive,
    internalCreate,
    normalizeEventName,
    context,
    queue,
    scratch,
  } = data;

  // Two objects reading the same queue would take turns losing messages.
  const listeners = new Map<string, string>();
  for (const spec of objects) {
    for (const raw of Object.keys(spec.receive ?? {})) {
      const event = normalizeEventName(raw);
      const taken = listeners.get(event);
      if (taken) {
        throw new Error(
          `mod ${identity.id}: both ${taken} and ${spec.name} receive ${JSON.stringify(event)}. ` +
            `They would race for each message; give it to one of them.`,
        );
      }
      listeners.set(event, spec.name);
    }
  }
  for (const event of Object.keys(internalReceive)) listeners.set(event, `${prefix}inbox`);

  const drain = (event: string, body: string) => `while (ds_list_size(${queue(event)}) > 0) {
    ${scratch("pl")} = ds_list_find_value(${queue(event)}, 0);
    ds_list_delete(${queue(event)}, 0);
    ${body}
  }`;

  if (listeners.size > 0) {
    const events = [...listeners.keys()];
    const route = events
      .map(
        (event, index) =>
          `${index === 0 ? "if" : "else if"} (${scratch("ev")} == "${event}") ` +
          `ds_list_add(${queue(event)}, ${scratch("pl")});`,
      )
      .join("\n");
    const internalDispatch = Object.entries(internalReceive)
      .map(([event, body]) => drain(event, body))
      .join("\n");

    hostApi.resource.create({
      kind: "object",
      name: `${prefix}inbox`,
      persistent: true,
      visible: false,
      depth: 0,
      events: {
        create:
          events.map((event) => `${queue(event)} = ds_list_create();`).join("\n") + internalCreate,
        step: internalDispatch || undefined,
        // Begin Step: drained before any mod object's Step, so they see this frame's mail.
        beginStep: `${hostApi.gml.receive(scratch("m"))}
while (${scratch("m")} != "") {
  ${scratch("at")} = string_pos(" ", ${scratch("m")});
  if (${scratch("at")} > 1) {
    ${scratch("ev")} = string_copy(${scratch("m")}, 1, ${scratch("at")} - 1);
    ${scratch("pl")} = string_delete(${scratch("m")}, 1, ${scratch("at")});
    ${route}
  }
  ${hostApi.gml.receive(scratch("m"))}
}`,
      },
    });
  }

  for (const spec of objects) {
    const write = (gml: ObjectGml<string> | undefined): string | undefined => gml?.(context(spec));
    const dispatch = Object.entries(spec.receive ?? {})
      .map(([raw, handler]) =>
        drain(normalizeEventName(raw), handler({ ...context(spec), payload: scratch("pl") })),
      )
      .join("\n");
    const step = [dispatch, write(spec.events?.step)].filter(Boolean).join("\n");

    const events: Partial<Record<EventName, string>> = {};
    for (const [event, source] of [
      ["create", write(spec.events?.create)],
      ["beginStep", write(spec.events?.beginStep)],
      ["step", step || undefined],
      ["endStep", write(spec.events?.endStep)],
      ["draw", write(spec.events?.draw)],
      ["destroy", write(spec.events?.destroy)],
    ] satisfies [EventName, string | undefined][]) {
      if (source) events[event] = source;
    }

    hostApi.resource.create({
      kind: "object",
      name: `${prefix}o_${spec.name}`,
      depth: spec.depth,
      persistent: spec.persistent,
      visible: spec.visible,
      events,
    });
  }
};
