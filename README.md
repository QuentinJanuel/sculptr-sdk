# @sculptr/sdk

WIP

Write sculptr mods for GameMaker 8 and GameMaker Studio games.

```sh
npm install @sculptr/sdk
```

```ts
import { createMod } from "@sculptr/sdk";

export default createMod((mod) => {
  mod.resource.object.create({
    name: "greeter",
    persistent: true,
    events: {
      create: ({ send }) => send("hello", "string(room)"),
    },
  });
  mod.on("hello", (room) => console.log(`hello from ${room}`));
});
```
