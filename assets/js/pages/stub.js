// Honest placeholder for pages whose stage has not been built yet. It shows no data and fakes no functionality.
export function mount(root, { route }) {
  const wrap = document.createElement("section");
  wrap.className = "stub";
  const inner = document.createElement("div");
  inner.className = "wrap";
  const h = document.createElement("h2");
  h.textContent = route.title;
  const p = document.createElement("p");
  p.className = "lead";
  p.textContent = route.desc || "";
  const note = document.createElement("p");
  note.className = "empty";
  note.textContent = `Ye page abhi bana nahi hai. Development stage ${route.stage} mein ban jayega.`;
  inner.append(h, p, note);
  wrap.appendChild(inner);
  root.appendChild(wrap);
}
