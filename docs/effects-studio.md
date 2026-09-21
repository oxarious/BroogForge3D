# Effects Studio / FLUX

Open `/effects/` from BroogForge's Effects Studio sidebar link. The 3D generation
and texturing services remain independent and do not need to run for this demo.

## Implemented engines

- Three.js 0.186.0: one instanced 80-blade sculpture, studio environment,
  finish presets, pointer response, scroll-driven ring-to-helix transformation.
- Motion 13.4.0: hover springs, magnetic controls, card tilt, chapter transitions.
- Anime.js 4.5.0: staggered entrance typography and coordinated reveal timeline.

Installed from their official npm packages; the lockfile records exact releases.
No premium APIs, remote scripts or paid components. Full upstream licence files
are copied into `public/effects/licenses`, alongside bundled licence comments.

## Customization

Use the sliders button for interaction intensity, speed, adaptive/battery/high
rendering, still mode, reset and JSON preset download. Preferences stay in local
browser storage. `effects/presets.js` validates defaults and external values.
`effects/main.js` contains the reusable scene and interaction implementation.
This is a working showcase and preset editor, not a general AI website generator.

## Build and portability

Run `pnpm build:effects` after source edits. The output and all visual assets are
in `public/effects/`, served by the existing local app without a server restart.
The demo has no generation API dependency. Its two back links point to the parent
BroogForge workspace and should be changed when embedding it elsewhere.

Product images were rendered locally in Blender using `scripts/render-flux.py`;
the WebP delivery images are under 65 KB each. Geist's OFL notice accompanies the
font. The Three.js scene is the primary experience, not the still-image fallback.

## Performance and access

- One instanced mesh for the sculpture. No real-time shadows, transmission pass,
  bloom, custom cursor overlay or multiple competing 3D canvases.
- Pixel ratio capped; mobile and battery saver limit rendering to roughly 30 FPS.
- Automatic movement rests after inactivity. Offscreen and hidden tabs stop the
  renderer. Any real performance claims require measurement on the target device.
- System reduced motion takes priority. All selections work by keyboard and touch.
- No WebGL: use the material images and controls. Context loss exposes a reload
  message; it does not erase the collection or trap page navigation.
- Asset and preset tests passed. Desktop 1440x900 and mobile 393x852 browser
  checks passed: nonblank/moving canvas, all chapters, material switching,
  still mode, reduced motion, settings, download and collection return links.
  No browser errors. The sculpture uses one draw call and 24,000 triangles.
  Screenshots and the report are saved under `artifacts/flux/qa`.
