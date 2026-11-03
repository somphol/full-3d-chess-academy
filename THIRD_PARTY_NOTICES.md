# Third-party notices

## Three.js

- Version: 0.169.0 (pinned in the import map in `index.html`)
- Source: https://github.com/mrdoob/three.js
- License: MIT
- Used modules: `three.module.js`, `examples/jsm/controls/OrbitControls.js`, `examples/jsm/environments/RoomEnvironment.js`, `examples/jsm/geometries/RoundedBoxGeometry.js`
- Delivery: jsDelivr CDN at runtime

Three.js is not bundled or modified. The page loads the published module files directly.

## Fonts

No web fonts are downloaded. The interface uses the operating system's UI, serif and Thai fonts through CSS font stacks (`Inter`, `SF Pro Text`, `Iowan Old Style`, `Palatino`, `Noto Sans Thai`, `Thonburi`). Those fonts remain under their own licences and are never redistributed.

## Sounds

All sound effects are synthesised at runtime with the Web Audio API. No audio files are included.

## Textures

The wood and slate board textures are drawn procedurally into a `<canvas>` at runtime with randomised grain and speckle. No image assets are used for the board.

## Other assets

The screenshots in `assets/` were captured from this application. The interface, piece geometry, copy, puzzles and engine were written for this project.

## Licence of this project

MIT; see [../LICENSE](../LICENSE).
