/* query params: id (groupId), pw (dashboard password) */
const q = new URLSearchParams(location.search);
const groupId = q.get('id');
const pass = q.get('pw') || '';

const fill = document.getElementById('fill');
const num = document.getElementById('num');
const infoPanel = document.getElementById('infoPanel');
const groupName = document.getElementById('groupName');
const targetValue = document.getElementById('targetValue');
const progressValue = document.getElementById('progressValue');
const remainingValue = document.getElementById('remainingValue');

let target = 1;
let last = 0;

function setGlow() {
    const g = Math.round(document.querySelector('.bar-wrap').offsetHeight * 0.35);
    document.documentElement.style.setProperty('--g', `${g}px`);
}
setGlow();
window.addEventListener('resize', setGlow);

// Overlay theme definitions
const OVERLAY_THEMES = {
    gold: {
        name: 'Gold Premium',
        primary: '#FFD700',
        secondary: '#FFFFFF',
        fill: 'transparent'
    },
    white: {
        name: 'White Elegant',
        primary: '#FFFFFF',
        secondary: '#FFFFFF',
        fill: 'transparent'
    },
    cyan: {
        name: 'Classic Cyan',
        primary: '#00CCFF',
        secondary: '#FFFFFF',
        fill: 'transparent'
    }
};

// Apply overlay theme
function applyOverlayTheme(themeName) {
    const theme = OVERLAY_THEMES[themeName] || OVERLAY_THEMES.gold;

    const root = document.documentElement;
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--secondary', theme.secondary);
    root.style.setProperty('--fill', theme.fill);

    console.log(`📐 Applied overlay theme: ${theme.name}`);
}

const sock = io();

sock.on('update', p => {
    target = p.target || target;

    const g = p.groups[groupId];
    if (!g) return;                        // unknown group

    // Apply overlay theme from group settings
    const overlayStyle = g.overlayStyle || 'gold'; // Default to gold theme
    applyOverlayTheme(overlayStyle);

    const diamonds = (p.counters[groupId] || { diamonds: 0 }).diamonds;
    const pct = Math.min(100, (diamonds / target) * 100);

    fill.style.width = pct + '%';
    num.textContent = diamonds.toLocaleString();

    // Update info panel
    groupName.textContent = g.name;
    targetValue.textContent = target.toLocaleString();
    progressValue.textContent = pct.toFixed(1) + '%';
    remainingValue.textContent = Math.max(0, target - diamonds).toLocaleString();
    infoPanel.style.display = 'block';

    /* flash when value rises */
    if (diamonds > last) {
        num.classList.remove('flash');
        void num.offsetWidth;
        num.classList.add('flash');

        // Add particle effect
        createParticles();
    }
    last = diamonds;
});

// Create particle effect on gift receive
function createParticles() {
    const barWrap = document.querySelector('.bar-wrap');
    const particleCount = 5;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.bottom = '0';
        particle.style.animationDelay = (i * 0.1) + 's';

        barWrap.appendChild(particle);

        // Remove particle after animation
        setTimeout(() => particle.remove(), 2000);
    }
}

// Toggle info panel visibility on click
document.addEventListener('click', () => {
    if (infoPanel.style.display === 'none') {
        infoPanel.style.display = 'block';
    } else {
        infoPanel.style.display = 'none';
    }
});
