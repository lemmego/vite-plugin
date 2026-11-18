# @lemmego/vite

The Vite integration for Lemmego applications. It preserves the application
asset contract used by Lemmego's Inertia integration and exposes frontend pages
contributed by compiled Go modules.

## Installation

```sh
npm install -D @lemmego/vite
```

```js
import { defineConfig } from "vite";
import lemmego from "@lemmego/vite";

export default defineConfig({
  plugins: [
    lemmego({
      input: ["resources/js/app.tsx", "resources/css/app.css"],
      ssr: "resources/js/ssr.tsx",
      refresh: true,
    }),
  ],
});
```

The plugin writes client assets to `public/build`, the client manifest to
`public/build/manifest.json`, the development URL to `public/hot`, and the SSR
bundle to `bootstrap/ssr`.

## Frontend Contributions

Run `lemmego frontend sync` before Vite starts. The generated manifest is read
through two virtual modules:

```ts
import { pages } from "virtual:lemmego/pages";
import { modules } from "virtual:lemmego/modules";
```

Pages are keyed by their Inertia name and are lazy loaders. The package also
exports `resolvePageComponent` from `@lemmego/vite/inertia-helpers`.

The ambient declarations are available through `@lemmego/vite/client`.
