import { hsl } from 'd3-color';
import { getHslStringForLevel, isAngleInArc, getComputedColors } from './utils.js';
import { initAudio, playSuccess, playFail, playStart, getAudioData } from './audio.js';

export const difficulties = {
    easy: { speed: 1.2 * Math.PI, size: 0.4, trackWidthFactor: 0.12 }, 
    medium: { speed: 1.5 * Math.PI, size: 0.25, trackWidthFactor: 0.07 },
    hard: { speed: 1.8 * Math.PI, size: 0.15, trackWidthFactor: 0.035 }
};

export class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.colors = getComputedColors();
        
        // Canvas/Drawing state
        this.devicePixelRatio = window.devicePixelRatio || 1;
        this.size = 0;
        this.radius = 0;
        this.lineWidth = 0;

        // Visualizer state
        this.visualizerDrips = [];
        this.levelStartTime = 0;

        // Game state
        this.gameState = 'start';
        this.score = 0;
        this.angle = -Math.PI / 2;
        this.direction = 1;
        this.speed = 0;
        this.targetStartAngle = 0;
        this.targetSize = 0;
        this.lastFrameTime = 0;
        this.animationFrameId = null;
        this.currentDifficulty = 'easy';
        this.replayFrames = [];
        this.replayConfig = {};
        this.level = 0;
        this.tapsThisLevel = 0;
        this.tapsForNextLevel = 1;
        this.currentColorHsl = hsl(getHslStringForLevel(1));
        this.targetColorHsl = hsl(getHslStringForLevel(1));
        this.lastGameData = {};

        this.onGameOver = null;
        this.onScoreUpdate = null;
        this.onLevelUp = null;
    }

    resizeCanvas() {
        const parent = this.canvas.parentElement;
        const parentWidth = parent.offsetWidth;
        const parentHeight = parent.offsetHeight;

        let containerSize;

        // On landscape screens (like desktop), we want to simulate a portrait container
        // to keep the game feel consistent with mobile and fit for vertical video.
        if (parentWidth > parentHeight) {
            // Simulate a 9:16 aspect ratio container within the height of the screen.
            const simulatedWidth = parentHeight * (9 / 16);
            // If the simulated width is wider than the actual screen, just use the screen width.
            // Otherwise, use the simulated width. This creates a virtual "phone screen" area.
            containerSize = Math.min(simulatedWidth, parentWidth);
        } else {
            // On portrait screens (mobile), the width is the limiting factor.
            containerSize = parentWidth;
        }

        // Apply a scaling factor to the container size to determine the final canvas size.
        const canvasSize = containerSize * 0.9;
        
        this.canvas.style.width = `${canvasSize}px`;
        this.canvas.style.height = `${canvasSize}px`;

        this.size = canvasSize * this.devicePixelRatio;
        this.canvas.width = this.size;
        this.canvas.height = this.size;
        
        this.radius = this.size * 0.4;
        this.lineWidth = this.size * difficulties[this.currentDifficulty].trackWidthFactor;
        
        if (this.gameState !== 'playing') {
            this.draw();
        }
    }

    generateNewTarget() {
        this.targetStartAngle = Math.random() * Math.PI * 2;
    }

    start(difficulty) {
        this.currentDifficulty = difficulty;
        this.resizeCanvas();

        initAudio();
        playStart();
        
        const settings = difficulties[difficulty];
        this.speed = settings.speed;
        this.targetSize = settings.size;

        this.score = 0;
        this.angle = -Math.PI / 2;
        this.direction = 1;

        this.level = 1; // Start at level 1, not 0
        this.levelStartTime = performance.now();
        this.visualizerDrips = [];

        this.tapsThisLevel = 0;
        this.tapsForNextLevel = 1;
        
        this.currentColorHsl = hsl(getHslStringForLevel(1));
        this.targetColorHsl = hsl(getHslStringForLevel(1));

        this.generateNewTarget();
        
        this.gameState = 'playing';
        this.replayFrames = [];
        this.replayConfig = {
            difficulty: this.currentDifficulty,
            difficulties,
            colors: this.colors,
        };

        this.lastFrameTime = performance.now();
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));

        if (this.onScoreUpdate) this.onScoreUpdate(this.score);
        if (this.onLevelUp) this.onLevelUp(this.level, true); // Pass true to indicate initial level
    }

    gameOver() {
        playFail();
        this.gameState = 'gameover';
        this.visualizerDrips = []; // Clear visualizer on game over
        
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        
        this.replayFrames.push({
            angle: this.angle,
            targetStartAngle: this.targetStartAngle,
            targetSize: this.targetSize,
            score: this.score,
            level: this.level, 
            targetColor: this.currentColorHsl.toString(),
            success: false,
            timestamp: performance.now(),
        });

        this.lastGameData = {
            score: this.score,
            level: this.level,
            difficulty: this.currentDifficulty,
            replayData: {
                frames: this.replayFrames,
                config: this.replayConfig,
            },
            timestamp: new Date().toISOString(),
        };

        if (this.onGameOver) this.onGameOver(this.lastGameData);
    }

    drawVisualizer(currentTime) {
        const timeInLevel = (currentTime - this.levelStartTime) / 1000;
        const colorProgress = Math.min(timeInLevel / 15, 1); // Max intensity after 15s
    
        const startHue = this.currentColorHsl.h;
        const endHue = (startHue + 60) % 360; 
        const dripHue = startHue + (endHue - startHue) * colorProgress;
        
        const dripColor = hsl(dripHue, 100, 55);
    
        // Spawn new drips
        const spawnChance = 0.3 + colorProgress * 0.6; // Increase spawn rate over time
        if (Math.random() < spawnChance) {
            const spawnAngle = (this.angle + Math.PI) % (Math.PI * 2); // Opposite to line
            
            this.visualizerDrips.push({
                startAngle: spawnAngle,
                life: 1 + Math.random() * 2, // Drips last 1-3 seconds
                maxLength: Math.PI * (0.05 + Math.random() * 0.2),
                speed: (Math.PI / 4) * (0.5 + Math.random()),
                color: dripColor.copy({ opacity: 0.1 + Math.random() * 0.3 }),
                isOuter: Math.random() > 0.5
            });
        }
    
        // Update and draw drips
        this.ctx.lineCap = 'butt';
        this.ctx.save();
        this.ctx.translate(this.size / 2, this.size / 2);
    
        this.visualizerDrips = this.visualizerDrips.filter(drip => {
            drip.life -= (currentTime - this.lastFrameTime) / 1000;
            if (drip.life <= 0) return false;

            drip.startAngle -= this.direction * drip.speed * ((currentTime - this.lastFrameTime) / 1000);
            
            const currentLength = Math.min(1, (1 - drip.life / 3)) * drip.maxLength;
            const endAngle = drip.startAngle - currentLength;

            const radiusOffset = this.lineWidth * (drip.isOuter ? 0.7 : -0.7);
            const dripLineWidth = this.lineWidth * 0.4;

            this.ctx.beginPath();
            this.ctx.arc(0, 0, this.radius + radiusOffset, drip.startAngle, endAngle, true);
            this.ctx.strokeStyle = drip.color.toString();
            this.ctx.lineWidth = dripLineWidth;
            this.ctx.stroke();

            return true;
        });
    
        this.ctx.restore();
    }

    draw() {
        this.ctx.clearRect(0, 0, this.size, this.size);

        if (this.gameState === 'playing') {
             // The visualizer is now drawn based on time in level, not audio
        }

        this.ctx.save();
        this.ctx.translate(this.size / 2, this.size / 2);

        // Draw track
        this.ctx.beginPath();
        this.ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        this.ctx.strokeStyle = this.colors.secondary;
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.lineCap = 'butt';
        this.ctx.stroke();

        // Draw target zone
        if (this.targetSize > 0) {
            this.ctx.beginPath();
            this.ctx.arc(0, 0, this.radius, this.targetStartAngle, this.targetStartAngle + this.targetSize);
            this.ctx.strokeStyle = this.currentColorHsl.toString();
            this.ctx.lineWidth = this.lineWidth * 0.95;
            this.ctx.lineCap = 'round';
            this.ctx.stroke();
        }

        // Draw rotating line
        this.ctx.rotate(this.angle);
        this.ctx.beginPath();
        this.ctx.moveTo(this.radius - this.lineWidth / 2, 0);
        this.ctx.lineTo(this.radius + this.lineWidth / 2, 0);
        this.ctx.strokeStyle = this.colors.fail;
        this.ctx.lineWidth = this.lineWidth / 2.5;
        this.ctx.lineCap = 'butt';
        this.ctx.stroke();
        
        this.ctx.restore();
    }

    gameLoop(currentTime) {
        if (this.gameState !== 'playing') return;

        const deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;

        // Draw time-based visualizer first, underneath everything else
        this.drawVisualizer(currentTime);

        // Smooth color interpolation
        const lerpFactor = Math.min(deltaTime * 2.5, 1);
        this.currentColorHsl.h += (this.targetColorHsl.h - this.currentColorHsl.h) * lerpFactor;
        this.currentColorHsl.s += (this.targetColorHsl.s - this.currentColorHsl.s) * lerpFactor;
        this.currentColorHsl.l += (this.targetColorHsl.l - this.currentColorHsl.l) * lerpFactor;
        this.currentColorHsl.opacity += (this.targetColorHsl.opacity - this.currentColorHsl.opacity) * lerpFactor;

        this.angle += this.speed * this.direction * deltaTime;
        
        this.replayFrames.push({
            angle: this.angle,
            targetStartAngle: this.targetStartAngle,
            targetSize: this.targetSize,
            score: this.score,
            level: this.level,
            targetColor: this.currentColorHsl.toString(),
            timestamp: currentTime,
        });

        this.draw();
        this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
    }

    handleTap() {
        if (this.gameState !== 'playing') return;
        
        const angleTolerance = Math.atan2(this.lineWidth / 2.5, this.radius);
        const inZone = isAngleInArc(this.angle, this.targetStartAngle - angleTolerance, this.targetSize + 2 * angleTolerance);

        if (inZone) {
            playSuccess();
            this.score++;
            
            this.tapsThisLevel++;
            if (this.tapsThisLevel >= this.tapsForNextLevel) {
                this.levelUp();
            }

            this.direction *= -1;
            this.speed *= 1.04;

            const lastFrame = this.replayFrames[this.replayFrames.length - 1];
            if (lastFrame) {
                lastFrame.success = true;
                lastFrame.newTarget = {
                    start: this.targetStartAngle,
                    size: difficulties[this.currentDifficulty].size
                };
            }

            this.generateNewTarget();
            
            if (this.onScoreUpdate) this.onScoreUpdate(this.score);
        } else {
            this.gameOver();
        }
    }

    levelUp() {
        this.targetColorHsl = hsl(getHslStringForLevel(this.level + 1));
        
        this.level++;
        this.levelStartTime = performance.now(); // Reset timer on level up
        this.tapsThisLevel = 0;
        this.tapsForNextLevel = this.level;

        if (this.onLevelUp) this.onLevelUp(this.level);
    }

    reset() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.gameState = 'start';
        this.score = 0;
        this.level = 1;
        this.visualizerDrips = [];
        this.tapsThisLevel = 0;
        this.tapsForNextLevel = 1;
        this.currentColorHsl = hsl(getHslStringForLevel(1));
        this.targetSize = difficulties[this.currentDifficulty].size;
        this.targetStartAngle = Math.PI / 4;
        this.angle = -Math.PI / 2;
        this.resizeCanvas();
    }
}