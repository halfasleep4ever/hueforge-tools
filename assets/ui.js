// Shared page bits: header, file drop zone, downloads.
export function header(title) {
  const h = document.createElement("header"); h.className = "top";
  h.innerHTML = `<a class="home" href="../">◆ HueForge Tools</a><span class="muted">/ ${title}</span><span class="sp"></span><a href="../library/" class="small">Filament library</a><a href="../projects/" class="small">Projects</a>`;
  document.body.prepend(h);
}
export function dropZone(el, { accept = "*", multiple = false, onFiles }) {
  const inp = Object.assign(document.createElement("input"), { type: "file", accept, multiple, hidden: true });
  el.append(inp); el.onclick = () => inp.click();
  inp.onchange = () => inp.files.length && onFiles([...inp.files]);
  el.ondragover = e => { e.preventDefault(); el.classList.add("over"); };
  el.ondragleave = () => el.classList.remove("over");
  el.ondrop = e => { e.preventDefault(); el.classList.remove("over"); e.dataTransfer.files.length && onFiles([...e.dataTransfer.files]); };
}
export function download(name, data, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export function loadImage(file) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
