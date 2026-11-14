/**
 * Turning a rebindable key into the number GameMaker checks.
 *
 * A `keybind` control hands you a `KeyboardEvent.code` -- `"KeyH"`, `"ArrowLeft"`, `"Space"` -- which
 * names the *physical* key, so a binding made on an AZERTY keyboard stays under the same finger
 * rather than following the letter printed on it. GML wants a number: the Windows virtual-key code,
 * which is what `vk_left` is and what `ord("H")` comes out as.
 *
 * ```ts
 * const jump = mod.ui.state("KeyZ", { persist: "jump" });
 *
 * mod.resource.object.create({
 *   name: "mymod",
 *   vars: ["jumpKey"],
 *   events: {
 *     create: ({ v }) => `${v.jumpKey} = ${gameMakerKey("KeyZ")};`,
 *     step: ({ v, send }) => `
 *       if (${v.jumpKey} > 0 && keyboard_check_pressed(${v.jumpKey})) ${send("jump")}
 *     `,
 *   },
 *   receive: { key: ({ v, payload }) => `${v.jumpKey} = real(${payload});` },
 * });
 *
 * const push = () => mod.send("key", String(gameMakerKey(jump.value)));
 * mod.onStart(push);
 * ```
 *
 * The default in `create` matters: a game can run for a moment before the panel's first push
 * arrives, and a key of 0 matches nothing.
 */

/** The ones not derivable from the code. */
const KEYS: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  NumpadEnter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
  NumpadMultiply: 106,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadDecimal: 110,
  NumpadDivide: 111,
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
};

/**
 * The GameMaker key code for a `KeyboardEvent.code`, or `0` when there is no sensible one.
 *
 * `0` rather than a throw, and rather than a guess: an unbound control and a key GameMaker has no
 * number for should behave the same way -- nothing happens -- and neither is a reason to take a
 * running game down. Guard with `> 0` in the GML, since `keyboard_check_pressed(0)` is not reliably
 * false on every runner.
 *
 * Left and right modifiers collapse onto one code, which is what GameMaker offers: `vk_shift` is
 * either shift. A mod that needs to tell them apart cannot, here or in GML.
 */
export const gameMakerKey = function (code: string): number {
  if (!code) return 0;

  const known = KEYS[code];
  if (known !== undefined) return known;

  // "KeyH" -> 72, which is also ord("H"). The letter codes are their ASCII uppercase.
  if (code.length === 4 && code.startsWith("Key")) {
    const letter = code.charCodeAt(3);
    if (letter >= 65 && letter <= 90) return letter;
  }
  // "Digit7" -> 55, likewise ASCII.
  if (code.length === 6 && code.startsWith("Digit")) {
    const digit = code.charCodeAt(5);
    if (digit >= 48 && digit <= 57) return digit;
  }
  // "Numpad3" -> 99 (vk_numpad0 is 96).
  if (code.length === 7 && code.startsWith("Numpad")) {
    const digit = code.charCodeAt(6);
    if (digit >= 48 && digit <= 57) return 96 + (digit - 48);
  }
  // "F1" -> 112 ... "F24" -> 135 (vk_f1 is 112).
  const fkey = /^F(\d{1,2})$/u.exec(code);
  if (fkey) {
    const index = Number(fkey[1]);
    if (index >= 1 && index <= 24) return 111 + index;
  }
  return 0;
};
