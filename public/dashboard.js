const socket = io();
const catDiv = document.getElementById('catalogue');
const groupsDiv = document.getElementById('groups');
const giftUL = document.getElementById('giftStream');
const statsDiv = document.getElementById('stats');
const mobileStatsDiv = document.getElementById('mobileStats');
const catalogueSearch = document.getElementById('catalogueSearch');

/* top-bar buttons */
const btnConnect = document.getElementById('connect');
const btnDisconnect = document.getElementById('disconnect');
const btnNew = document.getElementById('newGroup');
const btnReset = document.getElementById('reset');
const btnTarget = document.getElementById('targetBtn');

let catalog = [], groups = {}, counters = {}, stats = {
    liveStatus: 'DISCONNECTED',
    username: '',
    liveViewers: 0,
    uniqueJoins: 0,
    totalGifts: 0,
    totalDiamonds: 0,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    isReconnecting: false,
    errorCount: 0,
    lastError: null
}, target = 10_000;

function updateButtonVisibility() {
    const isConnected = stats.liveStatus === 'ONLINE' || stats.liveStatus === 'CONNECTING' || stats.liveStatus === 'RECONNECTING';

    // Show/hide buttons based on connection status
    btnConnect.style.display = isConnected ? 'none' : 'flex';
    btnDisconnect.style.display = isConnected ? 'flex' : 'none';
}

/* ---------- connect / disconnect ---------- */
btnConnect.onclick = () => {
    fetch('/api/connect', { method: 'POST' })
        .then(() => showToast('Connecting to TikTok Live...', 'info'))
        .catch(() => showToast('Failed to connect', 'error'));
};

btnDisconnect.onclick = () => {
    fetch('/api/disconnect', { method: 'POST' })
        .then(() => showToast('Disconnected from TikTok Live', 'info'))
        .catch(() => showToast('Failed to disconnect', 'error'));
};

/* ---------- reset ---------- */
btnReset.onclick = () => {
    showModal({
        title: 'Reset Tracker',
        content: 'Are you sure you want to reset all counters? This action cannot be undone.',
        actions: [
            {
                label: 'Cancel',
                class: 'px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors',
                onClick: () => closeModal()
            },
            {
                label: 'Reset',
                class: 'px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors',
                onClick: () => {
                    fetch('/api/reset', { method: 'POST' })
                        .then(() => {
                            showToast('Tracker reset successfully', 'success');
                            closeModal();
                        })
                        .catch(() => showToast('Failed to reset', 'error'));
                }
            }
        ]
    });
};

/* ---------- new group ---------- */
btnNew.onclick = () => {
    showModal({
        title: 'Create New Group',
        content: `
            <label class="block text-sm font-medium text-gray-300 mb-2">Group Name</label>
            <input
                type="text"
                id="groupNameInput"
                class="w-full px-4 py-2 bg-dark-900 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="Enter group name"
                autofocus
            >
        `,
        actions: [
            {
                label: 'Cancel',
                class: 'px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors',
                onClick: () => closeModal()
            },
            {
                label: 'Create',
                class: 'px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-lg transition-all',
                onClick: () => {
                    const name = document.getElementById('groupNameInput').value.trim();
                    if (!name) {
                        showToast('Please enter a group name', 'error');
                        return;
                    }
                    const id = 'g' + Date.now().toString(36);
                    groups[id] = { name, giftIds: [], color: randomColor() };
                    saveGroups();
                    showToast(`Group "${name}" created`, 'success');
                    closeModal();
                }
            }
        ]
    });

    // Allow Enter key to submit
    setTimeout(() => {
        const input = document.getElementById('groupNameInput');
        input.focus();
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.querySelector('#modalActions button:last-child').click();
            }
        });
    }, 100);
};

/* ---------- target ---------- */
btnTarget.onclick = () => {
    showModal({
        title: 'Set Diamond Target',
        content: `
            <label class="block text-sm font-medium text-gray-300 mb-2">Diamond Target</label>
            <input
                type="number"
                id="targetInput"
                class="w-full px-4 py-2 bg-dark-900 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="Enter target amount"
                value="${target}"
                min="1"
                autofocus
            >
        `,
        actions: [
            {
                label: 'Cancel',
                class: 'px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors',
                onClick: () => closeModal()
            },
            {
                label: 'Set Target',
                class: 'px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-lg transition-all',
                onClick: () => {
                    const v = document.getElementById('targetInput').value;
                    if (!v || v < 1) {
                        showToast('Please enter a valid target', 'error');
                        return;
                    }
                    target = parseInt(v);
                    fetch('/api/target', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ target })
                    })
                        .then(() => {
                            showToast(`Target set to ${target.toLocaleString()} diamonds`, 'success');
                            closeModal();
                        })
                        .catch(() => showToast('Failed to set target', 'error'));
                }
            }
        ]
    });

    // Allow Enter key to submit
    setTimeout(() => {
        const input = document.getElementById('targetInput');
        input.focus();
        input.select();
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.querySelector('#modalActions button:last-child').click();
            }
        });
    }, 100);
};

/* ========== drag-and-drop gifts ========== */
let dragGiftId = null;

catDiv.addEventListener('dragstart', e => {
    // Check if the dragged element or its parent has the id
    const element = e.target.closest('[data-id]');
    if (element && element.dataset.id) {
        dragGiftId = element.dataset.id;
        element.classList.add('dragging');
        console.log('Dragging gift:', dragGiftId);
    }
});

catDiv.addEventListener('dragend', e => {
    const element = e.target.closest('[data-id]');
    if (element) {
        element.classList.remove('dragging');
    }
});

groupsDiv.addEventListener('dragover', e => {
    e.preventDefault();
    const box = e.target.closest('.group-card');
    if (box) {
        box.classList.add('drag-over');
    }
});

groupsDiv.addEventListener('dragleave', e => {
    const box = e.target.closest('.group-card');
    if (box && !box.contains(e.relatedTarget)) {
        box.classList.remove('drag-over');
    }
});

groupsDiv.addEventListener('drop', e => {
    e.preventDefault();
    const box = e.target.closest('.group-card');

    console.log('Drop event - box:', box, 'dragGiftId:', dragGiftId);

    if (!box || !dragGiftId) {
        console.log('Drop failed: box or dragGiftId is missing');
        return;
    }

    box.classList.remove('drag-over');
    const groupId = box.dataset.id;

    console.log('Adding gift', dragGiftId, 'to group', groupId);

    // Ensure giftIds array exists
    if (!groups[groupId].giftIds) {
        groups[groupId].giftIds = [];
    }

    if (!groups[groupId].giftIds.includes(Number(dragGiftId))) {
        groups[groupId].giftIds.push(Number(dragGiftId));
        saveGroups();
        showToast('Gift added to group', 'success');
    } else {
        showToast('Gift already in group', 'info');
    }

    dragGiftId = null;
});

/* ---------- socket events ---------- */
socket.on('update', p => {
    ({ groups, counters, target, stats } = p);
    drawGroups();
    updateStats();
});

socket.on('giftStream', d => {
    const emptyState = document.getElementById('emptyStream');
    if (emptyState) emptyState.style.display = 'none';

    const li = document.createElement('li');
    li.className = 'flex items-center space-x-3 p-3 bg-dark-800/50 rounded-lg border border-dark-700/50 hover:border-dark-600 transition-colors animate-slide-in';
    li.innerHTML = `
        <img src="${d.giftPictureUrl || ''}" width="32" height="32" class="rounded" onerror="this.style.display='none'">
        <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-white truncate">${d.nickname}</p>
            <p class="text-xs text-gray-400">sent ${d.giftName} ×${d.repeat_count || 1}</p>
        </div>
        <span class="text-sm font-semibold text-yellow-400">+${d.diamondCount * (d.repeat_count || 1)}💎</span>
    `;
    giftUL.prepend(li);
    trim(giftUL);
});

socket.on('giftCatalog', c => {
    catalog = c;
    drawCatalog();
});

/* ---------- error handling ---------- */
socket.on('error', errorData => {
    console.error('Connection error:', errorData);
    showToast(`Error: ${errorData.message}`, 'error');
});

/* ========== UI builders ========== */
function updateStats() {
    // Enhanced status colors and icons based on connection state
    let statusColor, statusIcon, statusText;

    switch (stats.liveStatus) {
        case 'ONLINE':
            statusColor = 'text-green-400';
            statusIcon = '<span class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>';
            statusText = 'ONLINE';
            break;
        case 'CONNECTING':
            statusColor = 'text-blue-400';
            statusIcon = '<span class="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>';
            statusText = 'CONNECTING';
            break;
        case 'RECONNECTING':
            statusColor = 'text-yellow-400';
            statusIcon = '<span class="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></span>';
            statusText = `RECONNECTING (${stats.reconnectAttempts}/${stats.maxReconnectAttempts})`;
            break;
        case 'OFFLINE':
            statusColor = 'text-orange-400';
            statusIcon = '<span class="w-2 h-2 bg-orange-400 rounded-full"></span>';
            statusText = 'OFFLINE';
            break;
        case 'DISCONNECTED':
        default:
            statusColor = 'text-gray-400';
            statusIcon = '<span class="w-2 h-2 bg-gray-400 rounded-full"></span>';
            statusText = 'DISCONNECTED';
            break;
    }

    // Update button visibility
    updateButtonVisibility();

    // Show error indicator if there are errors
    const errorIndicator = stats.errorCount > 0 ? `
        <div class="flex items-center space-x-1 text-red-400 cursor-pointer" onclick="showErrorLog()" title="Click to view errors">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
            <span class="text-xs font-semibold">${stats.errorCount}</span>
        </div>
    ` : '';

    const statsHTML = `
        <div class="flex items-center space-x-2">
            ${statusIcon}
            <span class="${statusColor} font-semibold">${statusText}</span>
            ${errorIndicator}
        </div>
        <div class="text-gray-400">@${stats.username || 'N/A'}</div>
        <div class="flex items-center space-x-1">
            <svg class="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
            </svg>
            <span class="text-white font-semibold">${stats.liveViewers || 0}</span>
        </div>
        <div class="flex items-center space-x-1">
            <svg class="w-4 h-4 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/>
            </svg>
            <span class="text-white font-semibold">${stats.uniqueJoins || 0}</span>
        </div>
        <div class="flex items-center space-x-1">
            <svg class="w-4 h-4 text-pink-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z"/>
            </svg>
            <span class="text-white font-semibold">${stats.totalGifts || 0}</span>
        </div>
        <div class="flex items-center space-x-1">
            <span class="text-yellow-400">💎</span>
            <span class="text-white font-semibold">${(stats.totalDiamonds || 0).toLocaleString()}</span>
        </div>
    `;

    statsDiv.innerHTML = statsHTML;

    // Mobile stats (simplified)
    const mobileStatsHTML = `
        ${statusIcon} ${stats.liveStatus || 'DISCONNECTED'} | @${stats.username || 'N/A'} |
        👀 ${stats.liveViewers || 0} |
        🎁 ${stats.totalGifts || 0} |
        💎 ${(stats.totalDiamonds || 0).toLocaleString()}
    `;
    mobileStatsDiv.innerHTML = mobileStatsHTML;
}

function drawCatalog(filter = '') {
    const term = filter.toLowerCase();
    const filtered = catalog.filter(g => g.name.toLowerCase().includes(term));

    catDiv.innerHTML = '';
    const emptyCatalogue = document.getElementById('emptyCatalogue');

    if (filtered.length === 0) {
        emptyCatalogue.classList.remove('hidden');
        return;
    }

    emptyCatalogue.classList.add('hidden');

    filtered.forEach(g => {
        const card = document.createElement('div');
        card.className = 'bg-dark-900/50 border border-dark-700 rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all group';
        card.draggable = true;
        card.dataset.id = g.id;
        card.innerHTML = `
            <div class="flex flex-col items-center text-center space-y-2">
                <img src="${g.iconUrl || ''}" width="32" height="32" class="group-hover:scale-110 transition-transform" onerror="this.style.display='none'">
                <span class="text-xs text-gray-300 line-clamp-2">${g.name}</span>
            </div>
        `;
        catDiv.appendChild(card);
    });
}

function drawGroups() {
    groupsDiv.innerHTML = '';

    if (Object.keys(groups).length === 0) {
        groupsDiv.innerHTML = `
            <div class="col-span-full text-center py-12">
                <svg class="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p class="text-gray-400 text-sm mb-4">No groups yet</p>
                <button onclick="document.getElementById('newGroup').click()" class="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-lg font-medium transition-all inline-flex items-center space-x-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>
                    <span>Create Your First Group</span>
                </button>
            </div>
        `;
        return;
    }

    for (const id in groups) {
        const g = groups[id];
        const c = counters[id] || { diamonds: 0 };
        const targetValue = target || 10000; // Use default if target is undefined
        const percentage = targetValue > 0 ? Math.min((c.diamonds / targetValue) * 100, 100) : 0;

        const icons = g.giftIds
            .map(gid => {
                const gift = catalog.find(x => x.id === gid);
                if (!gift) return '';
                return `
                    <span class="relative group/gift inline-block" data-gid="${gid}">
                        <img src="${gift.iconUrl || ''}" width="28" height="28" class="rounded hover:scale-110 transition-transform" onerror="this.style.display='none'">
                        <button class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs opacity-0 group-hover/gift:opacity-100 transition-opacity flex items-center justify-center remove-gift">×</button>
                    </span>`;
            })
            .join('');

        const groupCard = document.createElement('div');
        groupCard.className = 'group-card bg-dark-900/50 border-2 border-dashed rounded-xl p-4 transition-all hover:border-opacity-100 min-h-[180px] relative';
        groupCard.style.borderColor = g.color;
        groupCard.style.boxShadow = `0 0 20px ${g.color}40`;
        groupCard.dataset.id = id;

        groupCard.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <h3 class="font-semibold text-white truncate flex-1">${g.name}</h3>
                <div class="flex items-center space-x-1">
                    <button class="group-action p-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors" data-act="overlay" title="Open Overlay">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </button>
                    <button class="group-action p-1.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded transition-colors" data-act="edit" title="Edit Counter">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                    </button>
                    <button class="group-action p-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors" data-act="delete" title="Delete Group">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>

            <div class="mb-3">
                <div class="flex items-center justify-between text-sm mb-1">
                    <span class="text-gray-400">Progress</span>
                    <span class="text-yellow-400 font-semibold">${c.diamonds.toLocaleString()} 💎</span>
                </div>
                <div class="w-full bg-dark-700 rounded-full h-2 overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-500" style="width: ${percentage}%; background: ${g.color};"></div>
                </div>
                <div class="text-xs text-gray-500 mt-1 text-right">${percentage.toFixed(1)}% of ${targetValue.toLocaleString()}</div>
            </div>

            <div class="flex flex-wrap gap-2 min-h-[40px]">
                ${icons || '<span class="text-xs text-gray-500">No gifts added yet</span>'}
            </div>
        `;

        groupsDiv.appendChild(groupCard);
    }

    /* click handlers */
    groupsDiv.querySelectorAll('.group-card').forEach(box => {
        const gid = box.dataset.id;

        // Handle action buttons
        box.querySelectorAll('.group-action').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const action = btn.dataset.act;

                if (action === 'overlay') {
                    window.open(`/overlay.html?id=${gid}`, '_blank', 'width=1200,height=600');
                } else if (action === 'edit') {
                    const current = counters[gid]?.diamonds || 0;
                    showModal({
                        title: `Edit Counter - ${groups[gid].name}`,
                        content: `
                            <label class="block text-sm font-medium text-gray-300 mb-2">Diamond Count</label>
                            <input
                                type="number"
                                id="counterInput"
                                class="w-full px-4 py-2 bg-dark-900 border border-dark-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                value="${current}"
                                min="0"
                                autofocus
                            >
                        `,
                        actions: [
                            {
                                label: 'Cancel',
                                class: 'px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors',
                                onClick: () => closeModal()
                            },
                            {
                                label: 'Update',
                                class: 'px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-lg transition-all',
                                onClick: () => {
                                    const v = document.getElementById('counterInput').value;
                                    fetch('/api/counter', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ groupId: gid, diamonds: v })
                                    })
                                        .then(() => {
                                            showToast('Counter updated', 'success');
                                            closeModal();
                                        })
                                        .catch(() => showToast('Failed to update counter', 'error'));
                                }
                            }
                        ]
                    });

                    setTimeout(() => {
                        const input = document.getElementById('counterInput');
                        input.focus();
                        input.select();
                    }, 100);
                } else if (action === 'delete') {
                    showModal({
                        title: 'Delete Group',
                        content: `Are you sure you want to delete "${groups[gid].name}"? This action cannot be undone.`,
                        actions: [
                            {
                                label: 'Cancel',
                                class: 'px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors',
                                onClick: () => closeModal()
                            },
                            {
                                label: 'Delete',
                                class: 'px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors',
                                onClick: () => {
                                    delete groups[gid];
                                    saveGroups();
                                    showToast('Group deleted', 'success');
                                    closeModal();
                                }
                            }
                        ]
                    });
                }
            };
        });

        // Handle remove gift
        box.querySelectorAll('.remove-gift').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const giftElement = btn.closest('[data-gid]');
                const removeId = Number(giftElement.dataset.gid);
                groups[gid].giftIds = groups[gid].giftIds.filter(x => x !== removeId);
                saveGroups();
                showToast('Gift removed from group', 'success');
            };
        });
    });
}

/* ========== Modal System ========== */
function showModal({ title, content, actions }) {
    const modal = document.getElementById('modalContainer');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    const modalActions = document.getElementById('modalActions');

    modalTitle.textContent = title;
    modalContent.innerHTML = content;

    modalActions.innerHTML = '';
    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.textContent = action.label;
        btn.className = action.class;
        btn.onclick = action.onClick;
        modalActions.appendChild(btn);
    });

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('modalContainer');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

/* ========== Toast Notifications ========== */
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');

    const colors = {
        success: 'bg-green-500/90 border-green-400',
        error: 'bg-red-500/90 border-red-400',
        info: 'bg-blue-500/90 border-blue-400',
        warning: 'bg-yellow-500/90 border-yellow-400'
    };

    const icons = {
        success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />',
        error: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />',
        info: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />',
        warning: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />'
    };

    toast.className = `flex items-center space-x-3 px-4 py-3 rounded-lg border backdrop-blur-sm text-white shadow-lg animate-slide-in ${colors[type] || colors.info}`;
    toast.innerHTML = `
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            ${icons[type] || icons.info}
        </svg>
        <span class="text-sm font-medium">${message}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/* ========== helpers ========== */
function saveGroups() {
    fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groups)
    });
}

function trim(ul) {
    while (ul.children.length > 100) ul.lastChild.remove();
}

function randomColor() {
    const colors = [
        '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
        '#10b981', '#06b6d4', '#6366f1', '#a855f7', '#f43f5e'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

/* ========== Error Log Viewer ========== */
function showErrorLog() {
    fetch('/api/errors')
        .then(res => res.json())
        .then(data => {
            const errorList = data.errors.length > 0 ?
                data.errors.map(err => `
                    <div class="p-3 bg-dark-800/50 border border-dark-700 rounded-lg mb-2">
                        <div class="flex items-start justify-between mb-1">
                            <span class="text-xs font-semibold text-red-400">[${err.category}]</span>
                            <span class="text-xs text-gray-500">${new Date(err.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p class="text-sm text-white">${err.message}</p>
                        ${err.details ? `<p class="text-xs text-gray-400 mt-1">${err.details}</p>` : ''}
                        ${err.attempt > 0 ? `<span class="text-xs text-yellow-400">Attempt ${err.attempt}</span>` : ''}
                    </div>
                `).join('') :
                '<p class="text-gray-400 text-center py-4">No errors logged</p>';

            const reconnectInfo = data.isReconnecting ?
                `<div class="mb-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p class="text-sm text-yellow-400">🔄 Reconnecting... (${data.reconnectAttempts}/${data.maxReconnectAttempts})</p>
                </div>` : '';

            showModal({
                title: `Error Log (${data.count} errors)`,
                content: `
                    ${reconnectInfo}
                    <div class="max-h-96 overflow-y-auto space-y-2">
                        ${errorList}
                    </div>
                `,
                actions: [
                    {
                        label: 'Clear Log',
                        class: 'px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors',
                        onClick: () => {
                            fetch('/api/errors/clear', { method: 'POST' })
                                .then(() => {
                                    showToast('Error log cleared', 'success');
                                    closeModal();
                                })
                                .catch(() => showToast('Failed to clear log', 'error'));
                        }
                    },
                    {
                        label: 'Close',
                        class: 'px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors',
                        onClick: () => closeModal()
                    }
                ]
            });
        })
        .catch(() => showToast('Failed to load error log', 'error'));
}

/* ========== Search functionality ========== */
catalogueSearch.oninput = () => drawCatalog(catalogueSearch.value);

/* ========== Initial load ========== */
updateStats();
drawGroups();
drawCatalog();
