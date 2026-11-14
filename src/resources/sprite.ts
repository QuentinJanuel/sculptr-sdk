import type { Engine, HostApi, Identity } from "../host";
import type { EventHandler } from "../utils";

/** How long to wait for the game to confirm a picture before giving up on it. */
export const SPRITE_TIMEOUT_MS = 15_000;

/** How long to give the game to say where its files live, before writing anyway. */
export const WHERE_WAIT_MS = 2_000;

export interface SpriteOptions {
  frames?: number;
  origin?: { x: number; y: number };
  /**
   * Shrink any frame longer than this on its longest side before sending it.
   */
  maxSize?: number;
}

export interface SpriteSize {
  width: number;
  height: number;
}

/**
 * The picture itself.
 * Either a URL to fetch, a `data:` URI, or bytes.
 */
export type SpriteSource = string | Uint8Array | ArrayBuffer;

/**
 * A sprite this mod can fill with a picture while the game runs.
 *
 * Must be declared immediately but can be loaded anytime.
 */
export interface Sprite {
  /**
   * The sprite index, or `-1` if unloaded.
   * ```
   * draw: () => `if (${mySprite.id} >= 0) draw_sprite(${mySprite.id}, 0, x, y);`
   * ```
   */
  readonly id: string;
  /**
   * Every frame must be the same size.
   *
   * @returns the sprite size
   */
  load(frames: SpriteSource[]): Promise<SpriteSize>;
}

export interface SpriteActions {
  /**
   * Creates a new sprite.
   */
  create(name: string, options?: SpriteOptions): Sprite;
}

export interface ImageKind {
  extension: string;
  type: string;
}

export const getImageKind = (bytes: Uint8Array): ImageKind | null => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { extension: "png", type: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { extension: "jpg", type: "image/jpeg" };
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return { extension: "bmp", type: "image/bmp" };
  return null;
};

/**
 * The game restarted, and a newer load of the same pictures is on its way.
 */
export class SupersededTransfer extends Error {
  constructor() {
    super("superseded by a newer load after the game restarted");
  }
}

export const readBytes = async function (source: SpriteSource): Promise<Uint8Array> {
  if (typeof source !== "string") {
    return source instanceof Uint8Array ? source : new Uint8Array(source);
  }
  if (source.startsWith("data:")) {
    const comma = source.indexOf(",");
    if (comma < 0) throw new Error("that data: URI has no comma in it");
    const meta = source.slice(0, comma);
    const body = source.slice(comma + 1);
    if (!meta.endsWith(";base64")) return new TextEncoder().encode(decodeURIComponent(body));
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
    return bytes;
  }
  const response = await fetch(source, { cache: "no-store" });
  if (!response.ok) throw new Error(`${source}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

/**
 * Lays several pictures out left to right as one PNG.
 *
 * Every frame has to be the same size.
 */
export const composeStrip = async function (
  images: Uint8Array[],
  maxSize?: number,
): Promise<Uint8Array> {
  if (typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function") {
    const bitmaps = await Promise.all(
      images.map((bytes, index) => {
        const kind = getImageKind(bytes);
        if (!kind) throw new Error(`frame ${index + 1} is not a PNG, JPEG or BMP`);
        return createImageBitmap(new Blob([bytes as BlobPart], { type: kind.type }));
      }),
    );
    const first = bitmaps[0]!;
    for (const [index, bitmap] of bitmaps.entries()) {
      if (bitmap.width !== first.width || bitmap.height !== first.height) {
        throw new Error(
          `frame ${index + 1} is ${bitmap.width}x${bitmap.height} but frame 1 is ` +
            `${first.width}x${first.height}; every frame of a sprite is the same size`,
        );
      }
    }
    const scale = maxSize ? Math.min(1, maxSize / Math.max(first.width, first.height)) : 1;
    const width = Math.max(1, Math.round(first.width * scale));
    const height = Math.max(1, Math.round(first.height * scale));
    const canvas = new OffscreenCanvas(width * bitmaps.length, height);
    const context = canvas.getContext("2d")!;
    bitmaps.forEach((bitmap, index) => {
      context.drawImage(bitmap, index * width, 0, width, height);
      bitmap.close();
    });
    return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  }

  throw new Error("this host has no canvas to compose a sprite strip with");
};

export const toPng = async function (
  bytes: Uint8Array,
  type: string,
  maxSize?: number,
): Promise<Uint8Array> {
  if (typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const scale = maxSize ? Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height)) : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  }

  throw new Error("this host has no canvas to re-encode a picture with");
};

/**
 * The directory the game reads its mod files from, as a GML *value* it can report.
 *
 * The host writes the picture; what it needs back is the string the game puts in front of a
 * filename, and only the game can say. `game_save_id` rather than `working_directory` for
 * GameMaker Studio, and the difference is the whole point: a Studio runner re-roots every path a
 * game opens into its save area, so a file written next to the game is looked for somewhere else
 * entirely and reads as missing.
 */
export const scratchHere = (engine: Engine): string =>
  engine === "gm8" ? `temp_directory + "\\"` : `game_save_id`;

/** Everything the two sides say to each other about pictures. */
export const SPR = {
  /** host -> game: the picture is on the filesystem; add it. */
  put: "__spr_put",
  /** game -> host: added, with its size. */
  ok: "__spr_ok",
  /** game -> host: could not. */
  failed: "__spr_failed",
  /** game -> host: I have (re)started, and hold no pictures. */
  hello: "__spr_hello",
  /** game -> host: this is where I read files from. */
  where: "__spr_where",
} as const;

export const getSpriteLoader = function (data: {
  identity: Identity;
  hostApi: HostApi;
  sendInternal: (event: string, payload?: string) => void;
}) {
  interface InFlight {
    /** Which sprite this transfer is for, so an answer about another one is not mistaken for it. */
    slot: string;
    done(size: SpriteSize): void;
    failed(reason: string): void;
    abandon(): void;
  }
  /** The picture waiting on the game, if any. One at a time. */
  let inFlight: InFlight | null = null;
  /** The directory the game reads from, once it has said. */
  let scratchAt = "";
  /**
   * Resolves when the game has said where that is.
   *
   * The wait is load-bearing: the game answers from its Create, while a mod can ask for a picture
   * as soon as the channel opens, which is earlier. Writing before the answer lands puts the file
   * somewhere the game will never look.
   */
  let sawWhere!: () => void;
  const whereKnown = new Promise<void>((resolve) => {
    sawWhere = resolve;
  });
  let queueTail: Promise<unknown> = Promise.resolve();
  /** Resolves when the game is there to answer. */
  const live = new Promise<void>((resolve) => {
    data.hostApi.on("start", resolve);
  });

  const readPicture = async function (
    source: SpriteSource | SpriteSource[],
    options: SpriteOptions,
  ): Promise<{ bytes: Uint8Array; extension: string; frames: number }> {
    const sources = Array.isArray(source) ? source : [source];
    if (sources.length === 0) throw new Error("there is no picture in that list");
    const images = await Promise.all(sources.map((one) => readBytes(one)));
    const each = options.frames ?? 1;
    if (images.length > 1) {
      return {
        bytes: await composeStrip(images, options.maxSize),
        extension: "png",
        frames: images.length * each,
      };
    }
    const bytes = images[0]!;
    const kind = getImageKind(bytes);
    if (!kind) throw new Error("those bytes are not a PNG, JPEG or BMP");
    const wrongFormat = data.hostApi.target.engine === "gms" && kind.extension !== "png";
    const tooBig = options.maxSize !== undefined;
    if (!wrongFormat && !tooBig) return { bytes, extension: kind.extension, frames: each };
    return {
      bytes: await toPng(bytes, kind.type, options.maxSize),
      extension: "png",
      frames: each,
    };
  };

  /** Tells the game about a picture already on its filesystem, and waits for it to be added. */
  const announce = function (
    slot: string,
    options: SpriteOptions,
    frames: number,
    path: string,
  ): Promise<SpriteSize> {
    return new Promise<SpriteSize>((resolve, reject) => {
      const settle = (error: Error | null, size?: SpriteSize) => {
        clearTimeout(timer);
        inFlight = null;
        if (error) reject(error);
        else resolve(size!);
      };
      inFlight = {
        slot,
        done: (size) => settle(null, size),
        failed: (reason) => settle(new Error(reason)),
        abandon: () => settle(new SupersededTransfer()),
      };
      const origin = options.origin ?? { x: 0, y: 0 };
      // The path goes last: on a native install it is a Windows path, spaces and all.
      data.sendInternal(SPR.put, `${slot} ${frames} ${origin.x} ${origin.y} ${path}`);
      const timer = setTimeout(
        () => settle(new Error(`the game never answered about ${path}`)),
        SPRITE_TIMEOUT_MS,
      );
    });
  };

  const loadSprite = function (
    slot: string,
    options: SpriteOptions,
    source: SpriteSource | SpriteSource[],
    stillWanted: () => boolean = () => true,
  ): Promise<SpriteSize> {
    const run = async (): Promise<SpriteSize> => {
      const picture = await readPicture(source, options);
      await live;
      await Promise.race([
        whereKnown,
        new Promise<void>((resolve) => {
          setTimeout(resolve, WHERE_WAIT_MS);
        }),
      ]);
      if (!stillWanted()) throw new SupersededTransfer();
      const path = await data.hostApi.files.write(
        `${slot}.${picture.extension}`,
        picture.bytes,
        scratchAt,
      );
      if (!stillWanted()) throw new SupersededTransfer();
      return announce(slot, options, picture.frames, path);
    };
    // One at a time, in the order they were asked for: a mod loading four sprites at once should
    // get four sprites, not four half-written files racing each other.
    const next = queueTail.then(run, run);
    queueTail = next.catch(() => {});
    return next;
  };

  return {
    loadSprite,
    where: (dir: string) => {
      scratchAt = dir;
      sawWhere();
    },
    /*
     * The game's answers, matched against what is actually waiting.
     *
     * Transfers are one at a time, so in the ordinary run the answer can only be about the picture
     * in flight -- but `abandon` and the timeout both settle a transfer the game has already been
     * told about, and the game may answer it afterwards. Taken for the current transfer, that late
     * answer resolves it before the game has the picture: the mod is told the sprite holds its new
     * image while the engine still has the old one, and because every transfer after it is
     * answered by its predecessor, the channel stays one behind for the rest of the session.
     *
     * The slot has always been in both payloads; it simply was not read. Ignoring a mismatch costs
     * at worst one timeout, which is visible, where accepting it is silently wrong for ever.
     */
    done: (slot: string, size: SpriteSize) => {
      if (inFlight?.slot === slot) inFlight.done(size);
    },
    failed: (slot: string, reason: string) => {
      if (inFlight?.slot === slot) inFlight.failed(reason);
    },
    abandon: () => inFlight?.abandon(),
  };
};

export type SpriteLoader = ReturnType<typeof getSpriteLoader>;

export interface DeclaredSprite {
  name: string;
  options: SpriteOptions;
}

/**
 * Installs the GML half of the sprite transfer.
 *
 * @returns the GML handling each internal event, keyed by event name
 */
export const registerSprites = function (data: {
  hostApi: HostApi;
  prefix: string;
  sprites: DeclaredSprite[];
  payload: string;
  sendInternalGml: (event: string, expression?: string) => string;
}): Record<string, string> {
  const { hostApi, prefix, sprites, payload, sendInternalGml } = data;
  if (sprites.length === 0) return {};

  const g = (name: string) => `global.${prefix}__${name}`;
  const field = `${prefix}__sprfield`;
  const rest = `${prefix}__sprrest`;

  /** Field `n` of a space-separated message. */
  hostApi.resource.create({
    kind: "script",
    name: field,
    source: `${g("fs")} = argument0;
${g("fn")} = 1;
while (${g("fn")} < argument1) {
  ${g("fat")} = string_pos(" ", ${g("fs")});
  if (${g("fat")} == 0) return "";
  ${g("fs")} = string_delete(${g("fs")}, 1, ${g("fat")});
  ${g("fn")} += 1;
}
${g("fat")} = string_pos(" ", ${g("fs")});
if (${g("fat")} > 0) ${g("fs")} = string_copy(${g("fs")}, 1, ${g("fat")} - 1);
return ${g("fs")};`,
  });

  /** Everything from field `n` on, spaces and all -- a path is one field that can contain them. */
  hostApi.resource.create({
    kind: "script",
    name: rest,
    source: `${g("rs")} = argument0;
${g("rn")} = 1;
while (${g("rn")} < argument1) {
  ${g("rat")} = string_pos(" ", ${g("rs")});
  if (${g("rat")} == 0) return "";
  ${g("rs")} = string_delete(${g("rs")}, 1, ${g("rat")});
  ${g("rn")} += 1;
}
return ${g("rs")};`,
  });

  /*
   * Looking before leaping, on the engine where looking tells the truth.
   *
   * GameMaker 8 answers `file_exists` for any path and `sprite_add` returns -1 on a miss, so asking
   * first costs nothing and turns a wrong path into a plain answer.
   *
   * GameMaker Studio does neither. A real Studio runner sandboxes `file_exists` to the game's own
   * save area while `sprite_add` happily loads an absolute path, so the check would refuse a file
   * that was about to load perfectly well -- which is exactly what it did. OpenGM has the opposite
   * problem: its `sprite_add` throws on a missing file rather than answering -1, and the exception
   * takes the whole event with it. Neither is worth a branch here: the path handed over is composed
   * from the directory the game itself reported, so it is right or nothing is.
   */
  const guard =
    hostApi.target.engine === "gm8"
      ? `if (!file_exists(${g("sprfile")})) {
      ${sendInternalGml(SPR.failed, `${g("sprslot")} + " nothing at " + ${g("sprfile")}`)}
      exit;
    }`
      : "";

  const assign = sprites
    .map(
      ({ name }) => `if (${g("sprslot")} == "${name}") {
      if (is_real(global.${prefix}spr_${name}) && global.${prefix}spr_${name} >= 0) sprite_delete(global.${prefix}spr_${name});
      global.${prefix}spr_${name} = ${g("sprnew")};
    }`,
    )
    .join(" else ");

  return {
    /* "<slot> <imgs> <ox> <oy> <path...>": the host wrote the picture; add it and say how big it
     * came out. The path is last because it can contain spaces. */
    [SPR.put]: `${g("sprslot")} = ${field}(${payload}, 1);
    ${g("sprimgs")} = real(${field}(${payload}, 2));
    ${g("sprox")} = real(${field}(${payload}, 3));
    ${g("sproy")} = real(${field}(${payload}, 4));
    ${g("sprfile")} = ${rest}(${payload}, 5);
    ${guard}
    // is_real first: a game script named sprite_add shadows the builtin.
    ${g("sprnew")} = sprite_add(${g("sprfile")}, ${g("sprimgs")}, false, false, ${g("sprox")}, ${g("sproy")});
    if (is_real(${g("sprnew")}) && ${g("sprnew")} >= 0) {
      ${assign}
      ${sendInternalGml(
        SPR.ok,
        `${g("sprslot")} + " " + string(sprite_get_width(${g("sprnew")})) + " " + string(sprite_get_height(${g("sprnew")}))`,
      )}
    } else {
      ${sendInternalGml(SPR.failed, `${g("sprslot")} + " sprite_add answered " + string(${g("sprnew")})`)}
    }`,
  };
};

/**
 * The inbox object's Create: no sprites yet, and a word to the host.
 *
 * Runs again after a `game_restart()`, which frees every added sprite and wipes every global --
 * hence the hello, which means "I hold nothing; send it all again". That costs a write and a
 * message per picture, which is why nothing here tries to be clever about putting them back.
 */
export const spriteInboxCreate = function (data: {
  engine: Engine;
  prefix: string;
  sprites: DeclaredSprite[];
  sendInternalGml: (event: string, expression?: string) => string;
}): string {
  const { engine, prefix, sprites, sendInternalGml } = data;
  if (sprites.length === 0) return "";

  return `
${sprites.map(({ name }) => `global.${prefix}spr_${name} = -1;`).join("\n")}
${sendInternalGml(SPR.where, scratchHere(engine))}
${sendInternalGml(SPR.hello)}`;
};

export const registerSpriteHandlers = function (data: {
  identity: Identity;
  sprites: DeclaredSprite[];
  shown: Map<string, SpriteSource[]>;
  spriteLoader: SpriteLoader;
  handlers: Map<string, EventHandler[]>;
}) {
  const { identity, sprites, shown, spriteLoader, handlers } = data;
  if (sprites.length === 0) return;

  // Said once per (re)start, before the hello. Kept whatever happens next: the directory is a
  // property of the game, not of any one transfer.
  handlers.set(SPR.where, [(payload) => spriteLoader.where(payload)]);

  let hellos = 0;
  handlers.set(SPR.hello, [
    () => {
      // The first hello is the game starting, when nothing has been asked for yet.
      hellos += 1;
      if (hellos === 1 || shown.size === 0) return;

      // A restart freed every sprite the game had, so everything shown goes again. Writing a file
      // and naming it costs a few milliseconds each, which is why this is the whole recovery
      // story rather than something cleverer.
      spriteLoader.abandon();
      const generation = hellos;
      const current = () => generation === hellos;
      for (const [name, source] of shown) {
        const options = sprites.find((sprite) => sprite.name === name)?.options ?? {};
        spriteLoader.loadSprite(name, options, source, current).catch((error: unknown) => {
          if (error instanceof SupersededTransfer) return;
          console.error(`[${identity.id}] sprite ${JSON.stringify(name)} is gone:`, error);
        });
      }
    },
  ]);
  handlers.set(SPR.ok, [
    (payload) => {
      const [slot, width, height] = payload.split(" ");
      spriteLoader.done(slot ?? "", { width: Number(width), height: Number(height) });
    },
  ]);
  handlers.set(SPR.failed, [
    (payload) => {
      const at = payload.indexOf(" ");
      spriteLoader.failed(
        at < 0 ? payload : payload.slice(0, at),
        at < 0 ? "the game refused the picture" : payload.slice(at + 1),
      );
    },
  ]);
};
