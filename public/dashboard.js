const socket = io();
const catDiv = document.getElementById('catalogue');
const groupsDiv = document.getElementById('groups');
const giftUL = document.getElementById('giftStream');
const statsDiv = document.getElementById('stats');

/* top-bar buttons */
const btnConnect = document.getElementById('connect');
const btnDisconnect = document.getElementById('disconnect');
const btnNew = document.getElementById('newGroup');
const btnReset = document.getElementById('reset');
const btnTarget = document.getElementById('targetBtn');

let catalog = [], groups = {}, counters = {}, stats = {}, target = 10_000;

/* ---------- connect / disconnect ---------- */
btnConnect.onclick = () => fetch('/api/connect', { method: 'POST' });
btnDisconnect.onclick = () => fetch('/api/disconnect', { method: 'POST' });

/* ---------- reset, new group, target ---------- */
btnReset.onclick = () => fetch('/api/reset', { method: 'POST' });

/* ========== drag-and-drop gifts ========== */
let dragGiftId = null;
catDiv.addEventListener('dragstart', e => dragGiftId = e.target.dataset.id);
groupsDiv.addEventListener('dragover', e => e.preventDefault());
groupsDiv.addEventListener('drop', e => {
    const box = e.target.closest('.group');
    if (!box || !dragGiftId) return;
    groups[box.dataset.id].giftIds.push(Number(dragGiftId));
    saveGroups();
});

btnNew.onclick = () => {
    const name = prompt('Group name?');
    if (!name) return;
    const id = 'g' + Date.now().toString(36);
    groups[id] = { name, giftIds: [], color: randomColor() };
    saveGroups();
};

btnTarget.onclick = () => {
    const v = prompt('Global diamond target?', target);
    if (!v) return;
    target = parseInt(v) || target;
    fetch('/api/target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target })
    });
};

/* ---------- socket events ---------- */
socket.on('update', p => {
    ({ groups, counters, target, stats } = p);
    drawGroups();
    updateStats();
});
socket.on('giftStream', d => {
    const li = document.createElement('li');
    li.innerHTML =
        `<img src="${d.giftPictureUrl || ''}" width="20" style="vertical-align:middle"> ` +
        `${d.nickname} sent ${d.giftName} ×${d.repeat_count || 1} ` +
        `(+${d.diamondCount * (d.repeat_count || 1)}💎)`;
    giftUL.prepend(li);
    trim(giftUL);
});
socket.on('giftCatalog', c => { catalog = c; drawCatalog(); });

/* ========== UI builders ========== */
function updateStats() {
    statsDiv.textContent =
        `${stats.liveStatus} | @${stats.username} | 👀 ${stats.liveViewers} | ` +
        `🆕 ${stats.uniqueJoins} | 🎁 ${stats.totalGifts} | 💎 ${stats.totalDiamonds}`;
}

function drawCatalog(filter = '') {
    const term = filter.toLowerCase();
    catDiv.innerHTML = '';
    catalog
        .filter(g => g.name.toLowerCase().includes(term))
        .forEach(g => {
            catDiv.insertAdjacentHTML(
                'beforeend',
                `<div class="card" draggable="true" data-id="${g.id}">
           <img src="${g.iconUrl || ''}" width="24"><br>${g.name}
         </div>`
            );
        });
}

function drawGroups() {
    groupsDiv.innerHTML = '';

    for (const id in groups) {
        const g = groups[id];
        const c = counters[id] || { diamonds: 0 };

        const icons = g.giftIds
            .map(gid => {
                const gift = catalog.find(x => x.id === gid);
                if (!gift) return '';
                return `
          <span class="icon" data-gid="${gid}">
            <img src="${gift.iconUrl || ''}" width="24">
            <span class="del">×</span>
          </span>`;
            })
            .join('');

        groupsDiv.insertAdjacentHTML(
            'beforeend',
            `<div class="group" data-id="${id}"
             style="border-color:${g.color};box-shadow:0 0 .6rem ${g.color}">
         <div class="title">
           ${g.name}
           <button class="mini" data-act="overlay">▶</button>
           <button class="mini" data-act="edit">✏</button>
           <button class="mini" data-act="delete">🗑</button>
         </div>
         <div class="counts">${c.diamonds}💎</div>
         <div class="icons">${icons}</div>
       </div>`
        );
    }

    /* click handlers */
    groupsDiv.querySelectorAll('.group').forEach(box => {
        const gid = box.dataset.id;

        box.onclick = e => {
            /* overlay */
            if (e.target.dataset.act === 'overlay') {
                window.open(`/overlay.html?id=${gid}`, '_blank');
                return;
            }

            /* edit counter */
            if (e.target.dataset.act === 'edit') {
                const current = counters[gid]?.diamonds || 0;
                const v = prompt('Set diamonds to…', current);
                if (v === null) return;
                fetch('/api/counter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupId: gid, diamonds: v })
                });
                return;
            }

            /* delete group */
            if (e.target.dataset.act === 'delete') {
                if (!confirm('Delete this group?')) return;
                delete groups[gid];
                saveGroups();
                return;
            }

            /* remove gift from group */
            if (e.target.matches('.del')) {
                const removeId = Number(e.target.parentNode.dataset.gid);
                groups[gid].giftIds = groups[gid].giftIds.filter(x => x !== removeId);
                saveGroups();
            }
        };
    });
}

/* ========== helpers ========== */
function saveGroups() {
    fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groups)
    });
}
function trim(ul) { while (ul.children.length > 100) ul.lastChild.remove(); }
function randomColor() {
    return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

/* search box */
const search = document.createElement('input');
search.placeholder = 'Search gifts…';
search.oninput = () => drawCatalog(search.value);
document.getElementById('right').prepend(search);
