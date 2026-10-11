// Frame Studio geometry. Our own design: a three-layer rail (front lip, pocket, back lip),
// printed face down. All solids are built with Manifold, so the result is always watertight.
import { deps, fromManifold } from "../assets/mesh3d.js";

export const DEFAULTS = { w: 100, h: 150, t: 3.0, tol: 0.3, lip: 3, border: 12, front: 2, back: 1.6, backLip: 4,
  radius: 4, mode: "slide", stand: true, hanger: false, tabs: false };

export function frameInfo(p) {
  const pw = p.w + 2 * p.tol, ph = p.h + 2 * p.tol;
  const win = [p.w - 2 * p.lip, p.h - 2 * p.lip];
  const outer = [win[0] + 2 * p.border, win[1] + 2 * p.border];
  const depth = p.front + p.t + p.tol + (p.mode === "slide" ? p.back : 0);
  const wall = p.border - p.lip - p.tol;
  const warn = [];
  if (win[0] < 5 || win[1] < 5) warn.push("The lip is too wide for this print size.");
  if (wall < 2) warn.push(`Side wall is only ${wall.toFixed(1)} mm. Make the border wider.`);
  if (p.tabs && wall < 5) warn.push("Joining tabs need a side wall of 5 mm or more.");
  if (p.radius > p.border) warn.push("Corner radius is bigger than the border.");
  return { pocket: [pw, ph], win, outer, depth, wall, warn };
}

function rrect(CS, w, h, r) { // centred rounded rectangle
  r = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  if (r < 0.05) return CS.square([w, h], true);
  return CS.square([w - 2 * r, h - 2 * r], true).offset(r, "Round", 2, 48);
}
const box = (M, x0, y0, z0, x1, y1, z1) => M.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

export function buildFrame(p) {
  const { Manifold: M, CrossSection: CS } = deps().wasm;
  const I = frameInfo(p), [ow, oh] = I.outer, [pw, ph] = I.pocket, [ww, wh] = I.win;
  const zf = p.front, zp = p.front + p.t + p.tol, D = I.depth;
  let solid = rrect(CS, ow, oh, p.radius).extrude(D);
  const cuts = [];
  cuts.push(CS.square([ww, wh], true).extrude(zf + 0.02).translate([0, 0, -0.01]));                 // window
  cuts.push(box(M, -pw / 2, -ph / 2, zf, pw / 2, p.mode === "slide" ? oh : ph / 2, zp));                // pocket (+ slot out the top)
  if (p.mode === "slide") cuts.push(CS.square([pw - 2 * p.backLip, ph - 2 * p.backLip], true).extrude(D - zp + 0.02).translate([0, 0, zp - 0.01])); // back window
  else cuts.push(box(M, -pw / 2, -ph / 2, zp - 0.01, pw / 2, ph / 2, D + 0.01));
  const adds = [];
  if (p.stand) { // wedge foot on the back, at the bottom edge: the frame stands up on its own
    const fw = Math.min(40, ow * 0.4), fd = Math.max(25, oh * 0.18), fh = Math.min(oh * 0.35, 40);
    const y0 = -oh / 2, x0 = -fw / 2, x1 = fw / 2;
    const prism = M.hull([[x0, y0, D - 0.01], [x1, y0, D - 0.01], [x0, y0 + fh, D - 0.01], [x1, y0 + fh, D - 0.01], [x0, y0, D + fd], [x1, y0, D + fd]]);
    adds.push(prism);
  }
  if (p.hanger) { // boss with a keyhole slot at top centre of the back, plus two bumpers at the bottom
    const bh = 4, bw = 26, bl = 16, yTop = oh / 2 - Math.min(p.border, 10) * 0.5 - bl / 2 - 1;
    let boss = box(M, -bw / 2, yTop - bl / 2, D - 0.01, bw / 2, yTop + bl / 2, D + bh);
    const head = CS.circle(4.5, 40).translate([0, yTop - 3]).extrude(bh + 1).translate([0, 0, D - 0.5]);
    const neck = CS.square([4.2, 9], true).translate([0, yTop + 1.5]).extrude(1.6).translate([0, 0, D + bh - 1.6]);
    const under = CS.hull([CS.circle(4.5, 40).translate([0, yTop - 3]), CS.circle(4.5, 40).translate([0, yTop + 3.5])]).extrude(bh - 1.6 + 0.5).translate([0, 0, D - 0.5]);
    boss = boss.subtract(head).subtract(neck).subtract(under);
    adds.push(boss);
    for (const sx of [-1, 1]) adds.push(box(M, sx * (ow / 2 - p.border / 2) - 4, -oh / 2 + 3, D - 0.01, sx * (ow / 2 - p.border / 2) + 4, -oh / 2 + 11, D + bh));
  }
  let tabsCut = [];
  if (p.tabs) { // dovetails: tab on the right side, socket on the left; they slide together along the depth
    const dt = (grow) => new CS([[[0, -3 - grow], [0, 3 + grow], [3.5 + grow, 4.5 + grow], [3.5 + grow, -4.5 - grow]]]);
    for (const fy of [-0.25, 0.25]) {
      adds.push(dt(0).translate([ow / 2 - 0.5, fy * oh]).extrude(D));
      const g = p.tol / 2;
      tabsCut.push(dt(g).translate([-ow / 2 - 0.5, fy * oh]).extrude(D + 0.02).translate([0, 0, -0.01]));
    }
  }
  if (adds.length) solid = M.union([solid, ...adds]);
  solid = M.difference([solid, ...cuts, ...tabsCut]);
  const mesh = fromManifold(solid), vol = solid.getProperties().volume; solid.delete();
  return { mesh, info: I, volume: vol };
}
