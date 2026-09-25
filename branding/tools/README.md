# Flame mark tools

`build.js` generates every concept SVG in `../concepts/` and the mockup pages in `html/`.
`shot.js` renders a page to PNG with Playwright.

```sh
node build.js
NODE_PATH=$(npm root -g) node shot.js html/m1-hero.html ../mockups/1-concepts.png 1560 700
NODE_PATH=$(npm root -g) node shot.js html/m2-app-icons.html ../mockups/2-app-icons-and-sizes.png 1320 700
NODE_PATH=$(npm root -g) node shot.js html/m3-in-context.html ../mockups/3-in-context.png 1760 700
```

Each concept is a white mark on transparent (`x-name.svg`), a bolder variant for 16–48px
(`x-name-small.svg`), and a rounded-square app icon on the night gradient (`x-name-app-icon.svg`).
