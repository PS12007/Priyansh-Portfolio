/* ============================================
   UNIFIED THEME & ANIMATION ENGINE
   ============================================ */

// ============================================
// CENTRALIZED STATE MANAGEMENT
// ============================================

const ThemeEngine = {
    // Core State
    state: {
        // Theme
        baseTheme: 'dark', // 'dark' | 'light'
        presetTheme: null, // 'jungle' | 'sand' | 'ocean' | 'cyber' | 'mono' | 'lava' | null (custom)
        
        // Color System
        rainbowEnabled: true,
        colorMode: 'rainbow', // 'rainbow' | 'static' | 'custom-animated' | 'custom-static'
        customColors: ['#ff0080', '#00ffff', '#8000ff'],
        customAnimated: true,
        
        // Animation
        animationSpeed: 75, // 0-100 (faster default)
        glowIntensity: 50, // 0-100
        animationBehavior: 'flowing', // 'static' | 'breathing' | 'flowing' | 'reactive'
        reduceMotion: false,
        
        // Cursor
        cursorEnabled: false, // OFF by default
        cursorSize: 20,
        cursorGlowStrength: 50,
        cursorColorMode: 'rainbow', // 'rainbow' | 'accent' | 'custom'
        cursorCustomColor: '#00ffff',
        
        // Particles
        particlesEnabled: false,
        particleDensity: 50,
        particleSpeed: 50,
        particleColorMode: 'accent', // 'accent' | 'rainbow' | 'custom'
        particleCustomColor: '#00ffff',
        
        // Custom Theme Colors (when presetTheme is null)
        customTheme: {
            bgPrimary: null,
            bgSecondary: null,
            textPrimary: null,
            textSecondary: null,
            textMuted: null,
            accentColors: null
        }
    },
    
    // Preset Themes
    presets: {
        jungle: {
            bgPrimary: '#0a1a0a',
            bgSecondary: '#0f2a0f',
            bgTertiary: '#143a14',
            textPrimary: '#ffffff',
            textSecondary: '#b0d0b0',
            textMuted: '#608060',
            accentColors: ['#00ff80', '#80ff00', '#00ff40']
        },
        sand: {
            bgPrimary: '#1a1815',
            bgSecondary: '#2a2825',
            bgTertiary: '#3a3835',
            textPrimary: '#ffffff',
            textSecondary: '#d0c8b0',
            textMuted: '#908870',
            accentColors: ['#ffaa00', '#ff8800', '#ffcc00']
        },
        ocean: {
            bgPrimary: '#0a0f1a',
            bgSecondary: '#0f1a2a',
            bgTertiary: '#142a3a',
            textPrimary: '#ffffff',
            textSecondary: '#b0c0d0',
            textMuted: '#608090',
            accentColors: ['#0080ff', '#00ffff', '#00ff80']
        },
        cyber: {
            bgPrimary: '#000000',
            bgSecondary: '#0a0a0a',
            bgTertiary: '#141414',
            textPrimary: '#ffffff',
            textSecondary: '#b0b0b0',
            textMuted: '#666666',
            accentColors: ['#00ffff', '#8000ff', '#ff00ff']
        },
        mono: {
            bgPrimary: '#000000',
            bgSecondary: '#0a0a0a',
            bgTertiary: '#141414',
            textPrimary: '#ffffff',
            textSecondary: '#b0b0b0',
            textMuted: '#666666',
            accentColors: ['#00ffff']
        },
        lava: {
            bgPrimary: '#1a0000',
            bgSecondary: '#2a0000',
            bgTertiary: '#3a0000',
            textPrimary: '#ffffff',
            textSecondary: '#ffb0b0',
            textMuted: '#ff8080',
            accentColors: ['#ff0000', '#ff8000', '#ffaa00']
        }
    },
    
    // HSL Color Animation
    hueOffset: 0,
    animationFrame: null,
    colorUpdateInterval: 16, // ~60fps
    
    // Elements that need color updates
    colorElements: {
        borders: [],
        underlines: [],
        glows: [],
        text: [],
        cursor: null,
        particles: []
    },
    
    // ============================================
    // INITIALIZATION
    // ============================================
    
    init() {
        this.loadSettings();
        // Apply theme and colors immediately
        this.applyTheme();
        this.updateAllColors();
        this.applyAllSettings();
        this.startColorAnimation();
        this.initializeUI();
        this.initializeParticles();
        this.initializeCursor();
        this.initializeScrollAnimations();
        this.initializeImageTilt();
        this.initializeNavigation();
        this.initializeSettingsPanel();
        this.initializeKeyboardShortcuts();
    },
    
    // ============================================
    // HSL COLOR ANIMATION ENGINE
    // ============================================
    
    startColorAnimation() {
        if (this.state.reduceMotion) {
            this.stopColorAnimation();
            return;
        }
        
        // Stop any existing animation first
        this.stopColorAnimation();
        
        const animate = () => {
            // Recalculate speed each frame to allow dynamic changes
            const speed = 0.1 + (this.state.animationSpeed / 100) * 0.5; // 0.1 to 0.6 degrees per frame
            
            if ((this.state.rainbowEnabled && this.state.colorMode === 'rainbow') || 
                (this.state.colorMode === 'custom-animated' && this.state.customAnimated)) {
                this.hueOffset = (this.hueOffset + speed) % 360;
                this.updateAllColors();
            }
            
            this.animationFrame = requestAnimationFrame(animate);
        };
        
        animate();
    },
    
    stopColorAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    },
    
    // Darken a hex color
    darkenColor(hex, amount) {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return hex;
        
        const r = Math.max(0, Math.floor(rgb.r * (1 - amount)));
        const g = Math.max(0, Math.floor(rgb.g * (1 - amount)));
        const b = Math.max(0, Math.floor(rgb.b * (1 - amount)));
        
        return `#${[r, g, b].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('')}`;
    },
    
    // Convert HSL to RGB
    hslToRgb(h, s, l) {
        h = h % 360;
        s = s / 100;
        l = l / 100;
        
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        
        let r, g, b;
        
        if (h < 60) { r = c; g = x; b = 0; }
        else if (h < 120) { r = x; g = c; b = 0; }
        else if (h < 180) { r = 0; g = c; b = x; }
        else if (h < 240) { r = 0; g = x; b = c; }
        else if (h < 300) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }
        
        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);
        
        return `rgb(${r}, ${g}, ${b})`;
    },
    
    // Convert RGB hex to HSL
    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        
        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }
        
        return [h * 360, s * 100, l * 100];
    },
    
    // Convert hex to RGB
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    },
    
    // Generate gradient colors based on current hue offset
    generateGradientColors(count = 8) {
        // Custom animated mode - animate custom colors
        if (this.state.colorMode === 'custom-animated' && this.state.customAnimated) {
            const colors = [];
            const customColors = this.state.customColors;
            
            // For each position in the gradient, use a custom color and animate its hue
            for (let i = 0; i < count; i++) {
                const colorIndex = Math.floor((i / count) * customColors.length);
                const baseColor = customColors[colorIndex] || customColors[customColors.length - 1];
                const rgb = this.hexToRgb(baseColor);
                
                if (rgb) {
                    const [h, s, l] = this.rgbToHsl(rgb.r, rgb.g, rgb.b);
                    // Animate hue by adding offset
                    const animatedHue = (h + this.hueOffset) % 360;
                    colors.push(this.hslToRgb(animatedHue, s, l));
                } else {
                    colors.push(baseColor);
                }
            }
            
            return colors;
        }
        
        // Normal rainbow mode
        if (this.state.rainbowEnabled && this.state.colorMode === 'rainbow') {
            const colors = [];
            const hueStep = 360 / count;
            const saturation = 100;
            const lightness = 50;
            
            for (let i = 0; i < count; i++) {
                const hue = (this.hueOffset + i * hueStep) % 360;
                colors.push(this.hslToRgb(hue, saturation, lightness));
            }
            
            return colors;
        }
        
        // Static colors
        if (this.state.colorMode === 'custom-static' || this.state.colorMode === 'custom') {
            const customColors = [...this.state.customColors];
            // Expand to 8 colors by repeating
            while (customColors.length < count) {
                customColors.push(...customColors);
            }
            return customColors.slice(0, count);
        }
        
        // Default: use accent colors
        const accentColors = this.getCurrentAccentColors();
        const expanded = [];
        for (let i = 0; i < count; i++) {
            expanded.push(accentColors[i % accentColors.length]);
        }
        return expanded;
    },
    
    // Update all color-dependent elements
    updateAllColors() {
        const colors = this.generateGradientColors(8);
        const root = document.documentElement;
        
        // Ensure we always have 8 colors
        while (colors.length < 8) {
            colors.push(colors[colors.length - 1] || '#00ffff');
        }
        
        // Update CSS variables
        colors.forEach((color, index) => {
            root.style.setProperty(`--accent-${index + 1}`, color);
        });
        
        // Update cursor
        if (this.state.cursorEnabled && this.colorElements.cursor) {
            this.updateCursorColor();
        }
        
        // Update particles
        if (this.state.particlesEnabled) {
            this.updateParticleColors();
        }
    },
    
    // Get current accent colors (static or animated)
    getCurrentAccentColors() {
        // Check custom theme first
        if (this.state.customTheme && this.state.customTheme.accentColors && this.state.customTheme.accentColors.length > 0) {
            return this.state.customTheme.accentColors;
        }
        // Check preset theme
        if (this.state.presetTheme && this.presets[this.state.presetTheme]) {
            return this.presets[this.state.presetTheme].accentColors;
        }
        // Check custom colors
        if (this.state.customColors && this.state.customColors.length > 0) {
            return this.state.customColors;
        }
        return ['#00ffff'];
    },
    
    // ============================================
    // THEME APPLICATION
    // ============================================
    
    applyTheme() {
        const root = document.documentElement;
        let theme;
        
        if (this.state.presetTheme && this.presets[this.state.presetTheme]) {
            theme = this.presets[this.state.presetTheme];
        } else if (this.state.customTheme.bgPrimary) {
            theme = this.state.customTheme;
        } else {
            // Default theme based on baseTheme
            theme = this.state.baseTheme === 'light' ? {
                bgPrimary: '#ffffff',
                bgSecondary: '#f5f5f5',
                bgTertiary: '#e8e8e8',
                textPrimary: '#000000',
                textSecondary: '#404040',
                textMuted: '#808080'
            } : {
                bgPrimary: '#000000',
                bgSecondary: '#0a0a0a',
                bgTertiary: '#141414',
                textPrimary: '#ffffff',
                textSecondary: '#b0b0b0',
                textMuted: '#666666'
            };
        }
        
        root.style.setProperty('--bg-primary', theme.bgPrimary);
        root.style.setProperty('--bg-secondary', theme.bgSecondary);
        root.style.setProperty('--bg-tertiary', theme.bgTertiary);
        root.style.setProperty('--text-primary', theme.textPrimary);
        root.style.setProperty('--text-secondary', theme.textSecondary);
        root.style.setProperty('--text-muted', theme.textMuted);
        
        // Update navbar background to match theme
        const bgColor = this.hexToRgb(theme.bgSecondary);
        if (bgColor) {
            const navbarBg = `rgba(${bgColor.r}, ${bgColor.g}, ${bgColor.b}, 0.6)`;
            root.style.setProperty('--navbar-bg', navbarBg);
        }
        
        root.setAttribute('data-theme', this.state.baseTheme);
    },
    
    applyPresetTheme(presetName) {
        if (presetName === 'custom') {
            this.state.presetTheme = null;
            // Initialize custom theme if not set
            if (!this.state.customTheme.bgPrimary) {
                this.state.customTheme = {
                    bgPrimary: '#000000',
                    bgSecondary: '#0a0a0a',
                    bgTertiary: '#141414',
                    textPrimary: '#ffffff',
                    textSecondary: '#b0b0b0',
                    textMuted: '#666666',
                    accentColors: ['#ff0080', '#00ffff']
                };
            }
            this.applyTheme();
            this.updateAllColors();
            this.updateSettingsUI();
            this.saveSettings();
        } else {
            this.state.presetTheme = presetName;
            this.state.customTheme = { bgPrimary: null, bgSecondary: null, textPrimary: null, textSecondary: null, textMuted: null, accentColors: null };
            this.applyTheme();
            this.updateAllColors();
            this.updateSettingsUI();
            this.saveSettings();
        }
    },
    
    // ============================================
    // SETTINGS PERSISTENCE
    // ============================================
    
    saveSettings() {
        localStorage.setItem('portfolioThemeSettings', JSON.stringify(this.state));
    },
    
    loadSettings() {
        const saved = localStorage.getItem('portfolioThemeSettings');
        if (saved) {
            try {
                const settings = JSON.parse(saved);
                Object.assign(this.state, settings);
            } catch (e) {
                console.error('Error loading settings:', e);
            }
        }
    },
    
    resetToDefaults() {
        // Stop animations and effects
        this.stopColorAnimation();
        this.stopParticles();
        const cursor = document.getElementById('cursorTrail');
        if (cursor) cursor.style.display = 'none';
        
        // Reset to default state
        this.state = {
            baseTheme: 'dark',
            presetTheme: null,
            rainbowEnabled: true,
            colorMode: 'rainbow',
            customColors: ['#ff0080', '#00ffff', '#8000ff'],
            customAnimated: true,
            animationSpeed: 75,
            glowIntensity: 50,
            animationBehavior: 'flowing',
            reduceMotion: false,
            cursorEnabled: false,
            cursorSize: 20,
            cursorGlowStrength: 50,
            cursorColorMode: 'rainbow',
            cursorCustomColor: '#00ffff',
            particlesEnabled: false,
            particleDensity: 50,
            particleSpeed: 50,
            particleColorMode: 'accent',
            particleCustomColor: '#00ffff',
            customTheme: {
                bgPrimary: null,
                bgSecondary: null,
                textPrimary: null,
                textSecondary: null,
                textMuted: null,
                accentColors: null
            }
        };
        
        // Clear localStorage
        localStorage.removeItem('portfolioThemeSettings');
        
        // Reapply all settings
        this.applyAllSettings();
        
        // Reinitialize controls to update UI values
        this.setupSettingsControls();
        this.updateSettingsUI();
        
        // Update slider values in UI
        const speedSlider = document.getElementById('speedSlider');
        const glowSlider = document.getElementById('glowSlider');
        const speedValue = document.getElementById('speedValue');
        const glowValue = document.getElementById('glowValue');
        
        if (speedSlider) speedSlider.value = this.state.animationSpeed;
        if (glowSlider) glowSlider.value = this.state.glowIntensity;
        if (speedValue) speedValue.textContent = `${this.state.animationSpeed}%`;
        if (glowValue) glowValue.textContent = `${this.state.glowIntensity}%`;
        
        console.log('Settings reset to defaults');
    },
    
    applyAllSettings() {
        this.applyTheme();
        this.updateAllColors();
        
        // Apply animation speed
        const speed = 40 - (this.state.animationSpeed / 100) * 30;
        document.documentElement.style.setProperty('--animation-speed', `${speed}s`);
        
        // Apply glow intensity
        document.documentElement.style.setProperty('--glow-strength', this.state.glowIntensity / 100);
        
        // Apply motion reduction
        if (this.state.reduceMotion) {
            document.documentElement.setAttribute('data-reduce-motion', 'true');
            this.stopColorAnimation();
        } else {
            document.documentElement.removeAttribute('data-reduce-motion');
            // Always restart animation to ensure it's running
            this.startColorAnimation();
        }
        
        // Apply cursor
        if (!this.state.cursorEnabled) {
            const cursor = document.getElementById('cursorTrail');
            if (cursor) cursor.style.display = 'none';
        }
        
        // Apply particles
        if (!this.state.particlesEnabled) {
            this.stopParticles();
        }
    },
    
    // ============================================
    // CURSOR SYSTEM
    // ============================================
    
    initializeCursor() {
        if (!this.state.cursorEnabled) return;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        
        const cursor = document.getElementById('cursorTrail');
        if (!cursor) return;
        
        cursor.style.display = 'block';
        cursor.style.width = `${this.state.cursorSize}px`;
        cursor.style.height = `${this.state.cursorSize}px`;
        
        let mouseX = 0, mouseY = 0;
        let trailX = 0, trailY = 0;
        
        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            cursor.classList.add('active');
        });
        
        const animate = () => {
            const dx = mouseX - trailX;
            const dy = mouseY - trailY;
            
            trailX += dx * 0.1;
            trailY += dy * 0.1;
            
            cursor.style.left = `${trailX - this.state.cursorSize / 2}px`;
            cursor.style.top = `${trailY - this.state.cursorSize / 2}px`;
            
            requestAnimationFrame(animate);
        };
        
        animate();
        
        document.addEventListener('mouseleave', () => {
            cursor.classList.remove('active');
        });
        
        // Enhanced glow on interactive elements
        const interactiveElements = document.querySelectorAll('a, button, .project-card, .skill-card, .interest-card');
        interactiveElements.forEach(el => {
            el.addEventListener('mouseenter', () => {
                cursor.style.transform = 'scale(1.5)';
                cursor.style.opacity = '0.8';
            });
            
            el.addEventListener('mouseleave', () => {
                cursor.style.transform = 'scale(1)';
                cursor.style.opacity = '0.6';
            });
        });
        
        this.updateCursorColor();
    },
    
    updateCursorColor() {
        const cursor = document.getElementById('cursorTrail');
        if (!cursor) return;
        
        let color;
        if (this.state.cursorColorMode === 'rainbow') {
            color = this.hslToRgb(this.hueOffset, 100, 50);
        } else if (this.state.cursorColorMode === 'accent') {
            const accents = this.getCurrentAccentColors();
            color = accents[0] || '#00ffff';
        } else {
            color = this.state.cursorCustomColor;
        }
        
        cursor.style.borderColor = color;
        cursor.style.boxShadow = `0 0 ${this.state.cursorGlowStrength / 5}px ${color}`;
    },
    
    // ============================================
    // PARTICLES SYSTEM
    // ============================================
    
    particles: [],
    particleCanvas: null,
    particleCtx: null,
    
    initializeParticles() {
        if (!this.state.particlesEnabled) return;
        
        const canvas = document.createElement('canvas');
        canvas.id = 'particlesCanvas';
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '1';
        canvas.style.opacity = '0';
        canvas.style.transition = 'opacity 0.5s ease';
        
        document.body.appendChild(canvas);
        this.particleCanvas = canvas;
        this.particleCtx = canvas.getContext('2d');
        
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        this.createParticles();
        this.animateParticles();
        
        // Fade in
        setTimeout(() => {
            canvas.style.opacity = '1';
        }, 100);
    },
    
    resizeCanvas() {
        if (!this.particleCanvas) return;
        this.particleCanvas.width = window.innerWidth;
        this.particleCanvas.height = window.innerHeight;
    },
    
    createParticles() {
        const density = this.state.particleDensity / 10; // 0-10 particles
        const count = Math.floor((window.innerWidth * window.innerHeight) / 15000 * density);
        
        this.particles = [];
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                vx: (Math.random() - 0.5) * (this.state.particleSpeed / 50),
                vy: (Math.random() - 0.5) * (this.state.particleSpeed / 50),
                size: Math.random() * 2 + 0.5,
                opacity: Math.random() * 0.3 + 0.1
            });
        }
    },
    
    animateParticles() {
        if (!this.particleCanvas || !this.particleCtx) return;
        if (!this.state.particlesEnabled) return;
        
        this.particleCtx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        const color = this.getParticleColor();
        
        this.particles.forEach(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            
            if (particle.x < 0 || particle.x > this.particleCanvas.width) particle.vx *= -1;
            if (particle.y < 0 || particle.y > this.particleCanvas.height) particle.vy *= -1;
            
            this.particleCtx.fillStyle = color.replace('rgb', 'rgba').replace(')', `, ${particle.opacity})`);
            this.particleCtx.beginPath();
            this.particleCtx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.particleCtx.fill();
        });
        
        requestAnimationFrame(() => this.animateParticles());
    },
    
    getParticleColor() {
        if (this.state.particleColorMode === 'rainbow') {
            return this.hslToRgb(this.hueOffset, 100, 50);
        } else if (this.state.particleColorMode === 'accent') {
            const accents = this.getCurrentAccentColors();
            return accents[0] || '#00ffff';
        } else {
            return this.state.particleCustomColor;
        }
    },
    
    updateParticleColors() {
        // Colors update automatically in animateParticles via getParticleColor
    },
    
    stopParticles() {
        if (this.particleCanvas) {
            this.particleCanvas.style.opacity = '0';
            setTimeout(() => {
                if (this.particleCanvas && this.particleCanvas.parentNode) {
                    this.particleCanvas.parentNode.removeChild(this.particleCanvas);
                }
                this.particleCanvas = null;
                this.particleCtx = null;
            }, 500);
        }
        this.particles = [];
    },
    
    // ============================================
    // SCROLL ANIMATIONS
    // ============================================
    
    initializeScrollAnimations() {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    
                    // Stagger animation for child elements
                    const children = entry.target.querySelectorAll('.experience-item, .project-card, .skill-card, .interest-card');
                    children.forEach((child, index) => {
                        setTimeout(() => {
                            child.classList.add('visible');
                        }, index * 100);
                    });
                }
            });
        }, observerOptions);
        
        document.querySelectorAll('.section').forEach(section => {
            observer.observe(section);
        });
        
        document.querySelectorAll('.experience-item, .project-card, .skill-card, .interest-card').forEach(item => {
            observer.observe(item);
        });
    },
    
    // ============================================
    // IMAGE TILT
    // ============================================
    
    initializeImageTilt() {
        const imageWrapper = document.querySelector('.image-wrapper');
        if (!imageWrapper) return;
        
        imageWrapper.addEventListener('mousemove', (e) => {
            const rect = imageWrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = (y - centerY) / 10;
            const rotateY = (centerX - x) / 10;
            
            imageWrapper.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        });
        
        imageWrapper.addEventListener('mouseleave', () => {
            imageWrapper.style.transform = 'perspective(1000px) rotateX(0) rotateY(0)';
        });
    },
    
    // ============================================
    // NAVIGATION
    // ============================================
    
    initializeNavigation() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                const href = this.getAttribute('href');
                if (href === '#') return;
                
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    const offset = 64;
                    const targetPosition = target.offsetTop - offset;
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            });
        });
        
        const sections = document.querySelectorAll('.section');
        const navLinks = document.querySelectorAll('.nav-link');
        
        const updateActiveNav = () => {
            let current = '';
            const scrollPos = window.scrollY + 100;
            
            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                const sectionHeight = section.offsetHeight;
                if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
                    current = section.getAttribute('id');
                }
            });
            
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${current}`) {
                    link.classList.add('active');
                }
            });
        };
        
        window.addEventListener('scroll', updateActiveNav);
        updateActiveNav();
    },
    
    // ============================================
    // SETTINGS PANEL UI
    // ============================================
    
    initializeSettingsPanel() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsPanel = document.getElementById('settingsPanel');
        const settingsClose = document.getElementById('settingsClose');
        
        if (!settingsBtn || !settingsPanel) {
            console.error('Settings elements missing:', { settingsBtn, settingsPanel });
            return;
        }
        
        // Simple toggle function
        const togglePanel = () => {
            settingsPanel.classList.toggle('active');
        };
        
        // Simple close function
        const closePanel = () => {
            settingsPanel.classList.remove('active');
        };
        
        // Attach events - use both onclick and addEventListener for maximum compatibility
        settingsBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        };
        
        if (settingsClose) {
            settingsClose.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                closePanel();
            };
        }
        
        // Close on outside click
        settingsPanel.onclick = (e) => {
            if (e.target === settingsPanel) {
                closePanel();
            }
        };
        
        // Initialize all controls
        this.setupSettingsControls();
        this.updateSettingsUI();
    },
    
    setupSettingsControls() {
        // Theme toggles - simple approach
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                const theme = btn.dataset.theme;
                this.state.baseTheme = theme;
                this.applyTheme();
                this.updateSettingsUI();
                this.saveSettings();
            };
        });
        
        // Preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                const preset = btn.dataset.preset;
                this.applyPresetTheme(preset);
                this.updateSettingsUI();
            };
        });
        
        // Custom theme color pickers
        const customThemeGroup = document.getElementById('customThemeGroup');
        const customBgPrimary = document.getElementById('customBgPrimary');
        const customBgSecondary = document.getElementById('customBgSecondary');
        const customTextPrimary = document.getElementById('customTextPrimary');
        const customTextSecondary = document.getElementById('customTextSecondary');
        const customAccent1 = document.getElementById('customAccent1');
        const customAccent2 = document.getElementById('customAccent2');
        
        if (customBgPrimary) {
            // Initialize values
            if (this.state.customTheme.bgPrimary) {
                customBgPrimary.value = this.state.customTheme.bgPrimary;
                customBgSecondary.value = this.state.customTheme.bgSecondary || '#0a0a0a';
                customTextPrimary.value = this.state.customTheme.textPrimary || '#ffffff';
                customTextSecondary.value = this.state.customTheme.textSecondary || '#b0b0b0';
                customAccent1.value = this.state.customTheme.accentColors?.[0] || '#ff0080';
                customAccent2.value = this.state.customTheme.accentColors?.[1] || '#00ffff';
            }
            
            const updateCustomTheme = () => {
                this.state.customTheme = {
                    bgPrimary: customBgPrimary.value,
                    bgSecondary: customBgSecondary.value,
                    bgTertiary: this.darkenColor(customBgSecondary.value, 0.1),
                    textPrimary: customTextPrimary.value,
                    textSecondary: customTextSecondary.value,
                    textMuted: this.darkenColor(customTextSecondary.value, 0.3),
                    accentColors: [customAccent1.value, customAccent2.value]
                };
                this.state.presetTheme = null;
                this.applyTheme();
                this.updateAllColors();
                this.saveSettings();
            };
            
            customBgPrimary.oninput = updateCustomTheme;
            if (customBgSecondary) customBgSecondary.oninput = updateCustomTheme;
            if (customTextPrimary) customTextPrimary.oninput = updateCustomTheme;
            if (customTextSecondary) customTextSecondary.oninput = updateCustomTheme;
            if (customAccent1) customAccent1.oninput = updateCustomTheme;
            if (customAccent2) customAccent2.oninput = updateCustomTheme;
        }
        
        // Rainbow toggle
        const rainbowToggle = document.getElementById('rainbowToggle');
        if (rainbowToggle) {
            rainbowToggle.checked = this.state.rainbowEnabled;
            rainbowToggle.onchange = (e) => {
                this.state.rainbowEnabled = e.target.checked;
                if (e.target.checked) {
                    this.state.colorMode = 'rainbow';
                }
                this.updateAllColors();
                this.startColorAnimation();
                this.updateSettingsUI();
                this.saveSettings();
            };
        }
        
        // Color mode buttons
        document.querySelectorAll('.color-mode-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                const mode = btn.dataset.mode;
                this.state.colorMode = mode;
                if (mode === 'rainbow') {
                    this.state.rainbowEnabled = true;
                } else if (mode === 'custom-animated') {
                    this.state.customAnimated = true;
                    this.state.rainbowEnabled = false; // Disable normal rainbow
                } else if (mode === 'custom-static' || mode === 'custom') {
                    this.state.customAnimated = false;
                    this.state.rainbowEnabled = false;
                }
                this.updateAllColors();
                this.startColorAnimation(); // Restart animation
                this.updateSettingsUI();
                this.saveSettings();
            };
        });
        
        // Sliders
        const speedSlider = document.getElementById('speedSlider');
        if (speedSlider) {
            speedSlider.value = this.state.animationSpeed;
            speedSlider.oninput = (e) => {
                const value = parseInt(e.target.value);
                this.state.animationSpeed = value;
                const speedValue = document.getElementById('speedValue');
                if (speedValue) speedValue.textContent = `${value}%`;
                this.startColorAnimation();
                this.saveSettings();
            };
        }
        
        const glowSlider = document.getElementById('glowSlider');
        if (glowSlider) {
            glowSlider.value = this.state.glowIntensity;
            glowSlider.oninput = (e) => {
                const value = parseInt(e.target.value);
                this.state.glowIntensity = value;
                document.documentElement.style.setProperty('--glow-strength', value / 100);
                const glowValue = document.getElementById('glowValue');
                if (glowValue) glowValue.textContent = `${value}%`;
                this.saveSettings();
            };
        }
        
        // Checkboxes
        const motionReduce = document.getElementById('motionReduce');
        if (motionReduce) {
            motionReduce.checked = this.state.reduceMotion;
            motionReduce.onchange = (e) => {
                this.state.reduceMotion = e.target.checked;
                this.applyAllSettings();
                this.saveSettings();
            };
        }
        
        const cursorEffects = document.getElementById('cursorEffects');
        if (cursorEffects) {
            cursorEffects.checked = this.state.cursorEnabled;
            cursorEffects.onchange = (e) => {
                this.state.cursorEnabled = e.target.checked;
                const cursorGroup = document.getElementById('cursorSettingsGroup');
                if (cursorGroup) {
                    cursorGroup.style.display = e.target.checked ? 'block' : 'none';
                }
                if (e.target.checked) {
                    this.initializeCursor();
                } else {
                    const cursor = document.getElementById('cursorTrail');
                    if (cursor) cursor.style.display = 'none';
                }
                this.saveSettings();
            };
        }
        
        const particlesToggle = document.getElementById('particlesToggle');
        if (particlesToggle) {
            particlesToggle.checked = this.state.particlesEnabled;
            particlesToggle.onchange = (e) => {
                this.state.particlesEnabled = e.target.checked;
                const particlesGroup = document.getElementById('particlesSettingsGroup');
                if (particlesGroup) {
                    particlesGroup.style.display = e.target.checked ? 'block' : 'none';
                }
                if (e.target.checked) {
                    this.initializeParticles();
                } else {
                    this.stopParticles();
                }
                this.saveSettings();
            };
        }
        
        // Cursor settings
        const cursorSizeSlider = document.getElementById('cursorSizeSlider');
        if (cursorSizeSlider) {
            cursorSizeSlider.value = this.state.cursorSize;
            cursorSizeSlider.oninput = (e) => {
                this.state.cursorSize = parseInt(e.target.value);
                const cursor = document.getElementById('cursorTrail');
                if (cursor) {
                    cursor.style.width = `${e.target.value}px`;
                    cursor.style.height = `${e.target.value}px`;
                }
                const sizeValue = document.getElementById('cursorSizeValue');
                if (sizeValue) sizeValue.textContent = `${e.target.value}px`;
                this.saveSettings();
            };
        }
        
        const cursorGlowSlider = document.getElementById('cursorGlowSlider');
        if (cursorGlowSlider) {
            cursorGlowSlider.value = this.state.cursorGlowStrength;
            cursorGlowSlider.oninput = (e) => {
                this.state.cursorGlowStrength = parseInt(e.target.value);
                this.updateCursorColor();
                const glowValue = document.getElementById('cursorGlowValue');
                if (glowValue) glowValue.textContent = `${e.target.value}%`;
                this.saveSettings();
            };
        }
        
        // Particle settings
        const particleDensitySlider = document.getElementById('particleDensitySlider');
        if (particleDensitySlider) {
            particleDensitySlider.value = this.state.particleDensity;
            particleDensitySlider.oninput = (e) => {
                this.state.particleDensity = parseInt(e.target.value);
                if (this.state.particlesEnabled) {
                    this.createParticles();
                }
                const densityValue = document.getElementById('particleDensityValue');
                if (densityValue) densityValue.textContent = `${e.target.value}%`;
                this.saveSettings();
            };
        }
        
        const particleSpeedSlider = document.getElementById('particleSpeedSlider');
        if (particleSpeedSlider) {
            particleSpeedSlider.value = this.state.particleSpeed;
            particleSpeedSlider.oninput = (e) => {
                this.state.particleSpeed = parseInt(e.target.value);
                if (this.state.particlesEnabled) {
                    this.createParticles();
                }
                const speedValue = document.getElementById('particleSpeedValue');
                if (speedValue) speedValue.textContent = `${e.target.value}%`;
                this.saveSettings();
            };
        }
        
        // Custom color pickers
        this.renderCustomColorPickers();
        const addColorBtn = document.getElementById('addColorBtn');
        if (addColorBtn) {
            addColorBtn.onclick = () => {
                if (this.state.customColors.length < 6) {
                    this.state.customColors.push('#00ffff');
                    this.renderCustomColorPickers();
                    this.updateAllColors();
                    this.saveSettings();
                }
            };
        }
        
        // Reset button
        const resetBtn = document.getElementById('resetSettingsBtn');
        if (resetBtn) {
            resetBtn.onclick = () => {
                this.resetToDefaults();
            };
        }
    },
    
    renderCustomColorPickers() {
        const container = document.getElementById('colorPickerContainer');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.state.customColors.forEach((color, index) => {
            const item = document.createElement('div');
            item.className = 'color-picker-item';
            
            const input = document.createElement('input');
            input.type = 'color';
            input.value = color;
            input.addEventListener('input', (e) => {
                this.state.customColors[index] = e.target.value;
                this.updateAllColors();
                this.saveSettings();
            });
            
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => {
                if (this.state.customColors.length > 1) {
                    this.state.customColors.splice(index, 1);
                    this.renderCustomColorPickers();
                    this.updateAllColors();
                    this.saveSettings();
                }
            });
            
            item.appendChild(input);
            item.appendChild(removeBtn);
            container.appendChild(item);
        });
    },
    
    updateSettingsUI() {
        // Update theme buttons
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            const theme = btn.dataset.theme;
            if (theme === this.state.baseTheme) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Update color mode buttons
        document.querySelectorAll('.color-mode-btn').forEach(btn => {
            const mode = btn.dataset.mode;
            if (mode === this.state.colorMode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Show/hide custom theme group
        const customThemeGroup = document.getElementById('customThemeGroup');
        if (customThemeGroup) {
            const isCustomTheme = !this.state.presetTheme && this.state.customTheme.bgPrimary;
            customThemeGroup.style.display = isCustomTheme ? 'block' : 'none';
        }
        
        // Show/hide custom colors group
        const customGroup = document.getElementById('customColorsGroup');
        if (customGroup) {
            const shouldShow = this.state.colorMode === 'custom' || 
                            this.state.colorMode === 'custom-static' || 
                            this.state.colorMode === 'custom-animated';
            customGroup.style.display = shouldShow ? 'block' : 'none';
        }
        
        // Show/hide cursor settings
        const cursorGroup = document.getElementById('cursorSettingsGroup');
        const cursorEffectsCheckbox = document.getElementById('cursorEffects');
        if (cursorGroup && cursorEffectsCheckbox) {
            cursorGroup.style.display = cursorEffectsCheckbox.checked ? 'block' : 'none';
        }
        
        // Show/hide particle settings
        const particlesGroup = document.getElementById('particlesSettingsGroup');
        const particlesToggle = document.getElementById('particlesToggle');
        if (particlesGroup && particlesToggle) {
            particlesGroup.style.display = particlesToggle.checked ? 'block' : 'none';
        }
    },
    
    // ============================================
    // KEYBOARD SHORTCUTS
    // ============================================
    
    initializeKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const settingsPanel = document.getElementById('settingsPanel');
                if (settingsPanel) settingsPanel.classList.remove('active');
            }
            
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const settingsPanel = document.getElementById('settingsPanel');
                if (settingsPanel) settingsPanel.classList.toggle('active');
            }
        });
    },
    
    // ============================================
    // UI INITIALIZATION
    // ============================================
    
    initializeUI() {
        // This will be called after DOM is ready
        // Additional UI setup can go here
    }
};

// Global function for inline onclick fallback
window.toggleSettingsPanel = function() {
    const panel = document.getElementById('settingsPanel');
    if (panel) {
        panel.classList.toggle('active');
        console.log('Settings panel toggled via global function');
    }
};

// Initialize when DOM is ready
function initializeTheme() {
    try {
        ThemeEngine.init();
        console.log('Theme engine initialized');
        
        // Ensure global toggle function is available
        window.toggleSettingsPanel = function() {
            const panel = document.getElementById('settingsPanel');
            if (panel) {
                panel.classList.toggle('active');
            }
        };
    } catch (error) {
        console.error('Error initializing theme engine:', error);
        // Fallback: at least show the page
        document.body.style.display = 'block';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTheme);
} else {
    // DOM is already loaded, initialize immediately
    initializeTheme();
}

// Update cursor color continuously
setInterval(() => {
    if (ThemeEngine.state.cursorEnabled) {
        ThemeEngine.updateCursorColor();
    }
}, 16);

