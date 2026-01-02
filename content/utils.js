// --- UTILS ---
function formatTime(seconds) {
    if(isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`;
}

function createButton(text, onClick) {
    const btn = document.createElement('button');
    btn.innerText = text;
    btn.className = 'insta-master-btn';
    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    };
    return btn;
}
