// Runs the cut off the main thread, so a big puzzle does not freeze the page.
import { loadDeps } from "../assets/mesh3d.js";
import { cutPuzzle } from "./puzzle.js";
self.onmessage = async ({ data: { mesh, opt } }) => {
  try {
    await loadDeps();
    const r = cutPuzzle(mesh, { ...opt, onProgress: (k, n) => self.postMessage({ progress: [k, n] }) });
    self.postMessage({ result: r }, r.pieces.flatMap(p => [p.mesh.pos.buffer, p.mesh.idx.buffer]));
  } catch (e) { self.postMessage({ error: e.message }); }
};
