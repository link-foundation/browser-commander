---
'browser-commander': minor
---

Add page-level keyboard interaction support (issue #37)

Expose keyboard input methods on the commander object, enabling users to press
keys, type text, and hold modifier keys without accessing the raw page object
directly. New API: `commander.keyboard.press()`, `commander.keyboard.type()`,
`commander.keyboard.down()`, `commander.keyboard.up()`, and flat aliases
`commander.pressKey()`, `commander.typeText()`, `commander.keyDown()`,
`commander.keyUp()`.
