/* query params: id (groupId), pw (dashboard password) */
const q = new URLSearchParams(location.search);
const groupId = q.get('id');
const pass = q.get('pw') || '';

const fill = document.getElementById('fill');
const num = document.getElementById('num');

let target = 1;
let last = 0;

function setGlow() {
    const g = Math.round(document.querySelector('.bar-wrap').offsetHeight * 0.35);
    document.documentElement.style.setProperty('--g', `${g}px`);
}
setGlow();
window.addEventListener('resize', setGlow);

const sock = io();

sock.on('update', p => {
    target = p.target || target;

    const g = p.groups[groupId];
    if (!g) return;                        // unknown group

    /* set color once (uses CSS var for both outline & fill) */
    if (document.documentElement.style.getPropertyValue('--c') === '')
        document.documentElement.style.setProperty('--c', g.color);

    const diamonds = (p.counters[groupId] || { diamonds: 0 }).diamonds;
    const pct = Math.min(100, (diamonds / target) * 100);

    fill.style.width = pct + '%';
    num.textContent = diamonds;

    /* flash when value rises */
    if (diamonds > last) {
        num.classList.remove('flash'); void num.offsetWidth; num.classList.add('flash');
    }
    last = diamonds;
});
