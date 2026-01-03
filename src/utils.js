export function createButton(text, onClick) {
  const btn = document.createElement("button");
  btn.innerText = text;
  btn.className = "insta-master-btn";
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };
  return btn;
}