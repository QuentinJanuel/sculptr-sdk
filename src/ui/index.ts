/**
 * A mod's own panel.
 *
 * The host shows it beside the running game, and in its own window for an installed one. The mod
 * describes it once; after that it never renders again, it just writes to the values it declared and
 * whatever showed them updates.
 *
 * ```ts
 * const channel = mod.ui.state("", { persist: "channel" });
 * const lines = mod.ui.state<string[]>([]);
 *
 * mod.ui.panel({ title: "Chat" }, (ui) => [
 *   ui.input({ label: "Channel", value: channel }),
 *   ui.scroll([ui.each(lines, (line) => ui.text(line), { key: (line) => line })], {
 *     grow: true,
 *     stickToBottom: true,
 *   }),
 * ]);
 * ```
 *
 * These types mirror the loader's own, structurally. The SDK is a published package that must build
 * on its own, so it states the shape it is written against rather than importing it -- the same way
 * `HostApi` is declared here rather than depended on.
 */

/** A value the panel can show and the player can change. Read and write `.value`. */
export interface Ref<T> {
  value: T;
}

/** A value derived from other values. Rendered, never written to. */
export interface ReadonlyRef<T> {
  readonly value: T;
}

/**
 * Anything a node property accepts.
 *
 * A plain value never changes. A `Ref` changes when you write to it. A function is read like a
 * `computed` -- handy for a label built out of other values, without naming it first.
 */
export type Bindable<T> = T | Ref<T> | ReadonlyRef<T> | (() => T);

/** What a render function returns, at any depth: one node, or several. */
export type UiSpec = UiNodeSpec | readonly UiNodeSpec[];

/** One node. Opaque -- build them with the `ui` builder, never by hand. */
export interface UiNodeSpec {
  readonly t: "element" | "dynamic" | "each";
}

/** How much a piece of text is trying to say. Never a colour: the app decides what these look like,
 *  and looks different in the dark panel beside a game than it would on a page. */
export type UiTone = "normal" | "muted" | "ok" | "warning" | "danger";

/** A button's weight. */
export type UiVariant = "normal" | "primary" | "danger" | "ghost";

export type UiGap = "none" | "small" | "normal" | "large";
export type UiAlign = "start" | "center" | "end" | "between";

export interface UiSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface UiSectionOptions {
  title?: Bindable<string>;
  /** Lets the player fold it away. The fold state belongs to the app, not to the mod. */
  collapsible?: boolean;
  grow?: boolean;
}

export interface UiRowOptions {
  align?: UiAlign;
  /** Defaults to true. The panel is narrow, and how narrow is not something a mod can know. */
  wrap?: boolean;
  grow?: boolean;
}

export interface UiColOptions {
  gap?: UiGap;
  grow?: boolean;
}

export interface UiScrollOptions {
  grow?: boolean;
  /** Keep the newest line in view as they arrive -- unless the player has scrolled up to read. */
  stickToBottom?: boolean;
  /**
   * A fixed height in pixels, rather than however tall its contents happen to be.
   *
   * For a box whose whole job is to hold a growing list -- a chat log, a run of events -- where the
   * panel jumping about as lines arrive is worse than the space an empty box costs. The box is the
   * same height holding nothing as holding a hundred lines.
   */
  height?: number;
}

export interface UiTextOptions {
  tone?: UiTone;
  strong?: boolean;
}

export interface UiButtonOptions {
  label: Bindable<string>;
  onClick?: () => void;
  variant?: UiVariant;
  disabled?: Bindable<boolean>;
  grow?: boolean;
}

export interface UiToggleOptions {
  label: Bindable<string>;
  /** A `Ref` here is two-way: the player flipping the switch writes it, like `v-model`. */
  value: Bindable<boolean>;
  onChange?: (value: boolean) => void;
  disabled?: Bindable<boolean>;
}

export interface UiInputOptions {
  /** A `Ref` here is two-way: what the player types is written straight into it. */
  value: Bindable<string>;
  label?: Bindable<string>;
  placeholder?: Bindable<string>;
  multiline?: boolean;
  onChange?: (value: string) => void;
  /** Enter in a single-line field. */
  onSubmit?: () => void;
  disabled?: Bindable<boolean>;
  grow?: boolean;
}

export interface UiSelectOptions {
  value: Bindable<string>;
  options: Bindable<readonly UiSelectOption[]>;
  label?: Bindable<string>;
  onChange?: (value: string) => void;
  disabled?: Bindable<boolean>;
}

export interface UiKeybindOptions {
  /**
   * A `KeyboardEvent.code` -- `"KeyH"`, `"ArrowLeft"`, `"Space"` -- or `""` for unbound. Two-way
   * when it is a `Ref`, like every other control's value.
   *
   * The *physical* key, not the letter printed on it, so a binding made on AZERTY stays under the
   * same finger. `gameMakerKey` turns one into the number GML checks.
   */
  value: Bindable<string>;
  label?: Bindable<string>;
  onChange?: (code: string) => void;
  disabled?: Bindable<boolean>;
}

export interface UiEachOptions<T> {
  /**
   * Stable identity for one item.
   *
   * Required rather than defaulted to the position, because the position is wrong in exactly the
   * case this exists for: add a line at the top and every position shifts, so a position-keyed list
   * redraws itself entirely instead of inserting one row.
   */
  key: (item: T, index: number) => string | number;
}

/**
 * Everything a panel is made of.
 *
 * Layout is expressed as intent, never as measurement: say which child should absorb the leftover
 * room with `grow`, and let the app decide what that means at the width it happens to have. There
 * are no pixels, no percentages and no styles here, which is what lets one panel work in a narrow
 * sidebar, on a phone, and in a desktop window without its author having thought about any of them.
 */
export interface UiBuilder {
  /** The primary grouping: a titled card. Vertical inside. */
  section(options: UiSectionOptions, children: UiSpec): UiNodeSpec;
  /** Horizontal, wrapping by default. */
  row(children: UiSpec, options?: UiRowOptions): UiNodeSpec;
  col(children: UiSpec, options?: UiColOptions): UiNodeSpec;
  grid(children: UiSpec, options: { columns: number; grow?: boolean }): UiNodeSpec;
  /** The one container that absorbs leftover height and scrolls. */
  scroll(children: UiSpec, options?: UiScrollOptions): UiNodeSpec;
  text(text: Bindable<string>, options?: UiTextOptions): UiNodeSpec;
  badge(label: Bindable<string>, options?: { tone?: UiTone }): UiNodeSpec;
  separator(): UiNodeSpec;
  spacer(): UiNodeSpec;
  /** 0..1. */
  progress(value: Bindable<number>, options?: { label?: Bindable<string> }): UiNodeSpec;
  button(options: UiButtonOptions): UiNodeSpec;
  toggle(options: UiToggleOptions): UiNodeSpec;
  input(options: UiInputOptions): UiNodeSpec;
  select(options: UiSelectOptions): UiNodeSpec;
  /**
   * A key the player can rebind.
   *
   * **The one control whose value you cannot bake into your GML.** A mod's code is written before
   * the player has said anything, so `keyboard_check_pressed(ord("H"))` fixes that key forever.
   * Keep the key in an instance variable, send the new one down when it changes, and the binding
   * follows. See `gameMakerKey` for the translation and a worked example.
   */
  keybind(options: UiKeybindOptions): UiNodeSpec;
  /**
   * A region that re-runs when any value it reads changes. For anything whose *shape* depends on
   * state -- a conditional, a different set of controls once connected.
   *
   * Keep it synchronous: a value read after an `await` is read outside the region, so it is not
   * noticed and the region will not re-run for it.
   */
  dynamic(fn: () => UiSpec): UiNodeSpec;
  /**
   * A keyed list.
   *
   * The item function runs per item and does not subscribe the list to what it reads, so one item's
   * value moving updates that item alone rather than redrawing everything.
   */
  each<T>(
    source: Bindable<readonly T[]>,
    render: (item: T, index: number) => UiSpec,
    options: UiEachOptions<T>,
  ): UiNodeSpec;
}

export interface UiStateOptions {
  /**
   * Keep this value between sessions, under this name.
   *
   * Stored by the host against the player's account when they are signed in, and in the browser
   * when they are not. It is an opaque bag as far as the app is concerned -- it stores what the mod
   * puts there and never reads into it -- which is what lets a mod have settings without the host
   * having to know what they are.
   */
  persist?: string;
}

/** `mod.ui`. */
export interface ModUi {
  /** A value the panel can show and the player can change. */
  state<T>(initial: T, options?: UiStateOptions): Ref<T>;
  /** A value derived from other values. */
  computed<T>(fn: () => T): ReadonlyRef<T>;
  /**
   * Declares a panel. Only while the mod is being built, like every other thing it declares.
   *
   * The render function runs once. What keeps the panel live afterwards are the values it read, so
   * there is nothing to call again and nothing for a mod to know about when its panel is on screen.
   */
  panel(options: { id?: string; title: string }, render: (ui: UiBuilder) => UiSpec): void;
}
