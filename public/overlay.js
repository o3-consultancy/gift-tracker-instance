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

// Overlay theme definitions - Professional Tier
const OVERLAY_THEMES = {
    diamond: {
        name: 'Diamond Luxury',
        primary: '#DA70D6',      // Orchid purple
        secondary: '#FF69B4',    // Hot pink
        fill: 'transparent',
        description: 'Purple/pink gradient with luxurious shimmer effect'
    },
    fire: {
        name: 'Fire Blaze',
        primary: '#FF4500',      // Orange red
        secondary: '#FFD700',    // Gold
        fill: 'transparent',
        description: 'Orange/red gradient with intense energy'
    },
    ocean: {
        name: 'Ocean Wave',
        primary: '#00CED1',      // Dark turquoise
        secondary: '#4169E1',    // Royal blue
        fill: 'transparent',
        description: 'Blue/teal gradient with calming depth'
    },
    neon: {
        name: 'Neon Pulse',
        primary: '#00FF00',      // Lime green
        secondary: '#00FFFF',    // Cyan
        fill: 'transparent',
        description: 'Electric green/cyan with vibrant energy'
    },
    sunset: {
        name: 'Sunset Glow',
        primary: '#FFD700',      // Gold
        secondary: '#FF8C00',    // Dark orange
        fill: 'transparent',
        description: 'Gold/orange gradient with warm glow'
    }
};

// Apply overlay theme
function applyOverlayTheme(themeName) {
    const theme = OVERLAY_THEMES[themeName] || OVERLAY_THEMES.diamond;

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
    const overlayStyle = g.overlayStyle || 'diamond'; // Default to diamond theme
    applyOverlayTheme(overlayStyle);

    const diamonds = (p.counters[groupId] || { diamonds: 0 }).diamonds;
    const pct = Math.min(100, (diamonds / target) * 100);

    fill.style.width = pct + '%';
    num.textContent = diamonds.toLocaleString();

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
