# Third-party notices

Claude Chat Relocator is released under the [MIT licence](LICENSE). It uses
the packages below at run time. They are not copied into this repository:
`npm install` downloads them, and each one's licence text is in its folder
under `node_modules/`.

| Package | Used for | Licence |
|---|---|---|
| [express](https://github.com/expressjs/express) | The local web server | MIT |
| [marked](https://github.com/markedjs/marked) | Turning Markdown in chats and in the help into HTML | MIT |
| [highlight.js](https://github.com/highlightjs/highlight.js) | Colouring code in chats | BSD-3-Clause |
| [adm-zip](https://github.com/cthackers/adm-zip) | Reading and writing zip files for Import / Export | MIT |

The icons are drawn in this repository's own code. No fonts, images or other
assets from third parties are included; the app uses the fonts already on
your computer.

The VS Code extension in `extension/` uses only Node.js and the VS Code API,
and has no third-party packages.
