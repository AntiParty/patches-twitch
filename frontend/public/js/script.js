const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const ctx = canvas.getContext('2d');

canvas.style.position = 'fixed';
canvas.style.top = '0';
canvas.style.left = '0';
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.zIndex = '-1';
canvas.style.pointerEvents = 'none';
// get badge dot text
const badgeDot = document.querySelector('.badge-dot');

let width, height;
let particles = [];

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

class Ember {
    constructor() {
        this.reset(true);
    }

    reset(initial = false) {
        this.x = Math.random() * width;
        this.y = initial ? Math.random() * height : height + 10;
        this.size = Math.random() * 2 + 0.5; // Tiny: 0.5px to 2.5px
        this.speedY = Math.random() * 0.3 + 0.1; // Very slow upward
        this.speedX = (Math.random() - 0.5) * 0.2; // Slight sway
        this.color = Math.random() > 0.7 ? '#d9002f' : '#ffffff'; // Mostly white/grey, some red
        // Max opacity for this ember
        this.maxAlpha = Math.random() * 0.4 + 0.1; // Max opacity 0.1 - 0.5
        // Start with a small randomized alpha so not all embers are invisible together
        this.alpha = initial ? Math.random() * this.maxAlpha : (Math.random() * this.maxAlpha * 0.6 + 0.02);
        this.maxLife = Math.random() * 300 + 200;
        // If this is the initial spawn, randomize life so particles are spread across phases
        this.life = initial ? Math.floor(Math.random() * this.maxLife) : 0;
        this.fadeState = this.alpha >= this.maxAlpha * 0.8 ? 'wait' : 'in'; // 'in' or 'out' or 'wait'
    }

    update() {
        this.y -= this.speedY;
        this.x += this.speedX;
        this.life++;

        // Fade in
        if (this.fadeState === 'in') {
            this.alpha += 0.01;
            if (this.alpha >= this.maxAlpha) {
                this.alpha = this.maxAlpha;
                this.fadeState = 'wait';
            }
        }
        // Start fading out near end of life
        else if (this.life > this.maxLife - 50) {
            this.fadeState = 'out';
        }

        // Fade out
        if (this.fadeState === 'out') {
            this.alpha -= 0.01;
        }

        // Reset when life exceeded or off screen
        if (this.life > this.maxLife || this.y < -10) {
            this.reset();
        }
    }

    draw() {
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function init() {
    particles = [];
    const particleCount = Math.max(60, Math.floor((width * height) / 10000)); // Moderate density, min 60
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Ember());
    }
}

function animate() {
    ctx.clearRect(0, 0, width, height);

    particles.forEach(p => {
        p.update();
        p.draw();
    });

    requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
    resize();
    init();
});

resize();
init();
animate();



// Mobile Menu Toggle
const menuBtn = document.querySelector('.mobile-menu-btn');
const navLinks = document.querySelector('.nav-links');

if (menuBtn) {
    menuBtn.addEventListener('click', () => {
        navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
        if (navLinks.style.display === 'flex') {
            navLinks.style.flexDirection = 'column';
            navLinks.style.position = 'absolute';
            navLinks.style.top = '70px';
            navLinks.style.left = '0';
            navLinks.style.width = '100%';
            navLinks.style.background = '#09090b';
            navLinks.style.padding = '2rem';
            navLinks.style.borderBottom = '1px solid #27272a';
        }
    });
}