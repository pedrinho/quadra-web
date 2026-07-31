import { GameEngine } from './engine/GameEngine';
import { InputManager } from './input/InputManager';
import { Renderer } from './renderer/Renderer';
import { AudioManager } from './audio/AudioManager';
import { NetworkManager } from './network/NetworkManager';
import { AssetManager } from './assets/AssetManager';

class QuadraWeb {
    private gameEngine: GameEngine;
    private inputManager: InputManager;
    private renderer: Renderer;
    private audioManager: AudioManager;
    private networkManager: NetworkManager;
    private assetManager: AssetManager;
    private canvas: HTMLCanvasElement;
    private loadingScreen: HTMLElement;
    private errorScreen: HTMLElement;
    private isRunning: boolean = false;

    constructor() {
        this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        this.loadingScreen = document.getElementById('loadingScreen') as HTMLElement;
        this.errorScreen = document.getElementById('errorScreen') as HTMLElement;
        
        if (!this.canvas) {
            throw new Error('Canvas element not found');
        }
    }

    async initialize(): Promise<void> {
        try {
            console.log('Initializing Quadra Web...');
            
            // Initialize core systems
            this.assetManager = new AssetManager();
            this.renderer = new Renderer(this.canvas);
            this.inputManager = new InputManager(this.canvas);
            this.audioManager = new AudioManager();
            this.networkManager = new NetworkManager();
            this.gameEngine = new GameEngine();

            // Initialize systems
            await this.renderer.initialize();
            await this.audioManager.initialize();
            await this.assetManager.initialize();
            await this.networkManager.initialize();
            await this.gameEngine.initialize();

            // Connect systems
            this.gameEngine.setRenderer(this.renderer);
            this.gameEngine.setInputManager(this.inputManager);
            this.gameEngine.setAudioManager(this.audioManager);
            this.gameEngine.setNetworkManager(this.networkManager);
            this.gameEngine.setAssetManager(this.assetManager);

            // Hide loading screen
            this.loadingScreen.style.display = 'none';
            
            console.log('Quadra Web initialized successfully');
            this.start();
        } catch (error) {
            console.error('Failed to initialize Quadra Web:', error);
            this.showError(`Initialization failed: ${error}`);
        }
    }

    private start(): void {
        this.isRunning = true;
        this.gameLoop();
    }

    private gameLoop(): void {
        if (!this.isRunning) return;

        const currentTime = performance.now();
        
        // Update game state
        this.gameEngine.update(currentTime);
        
        // Render frame
        this.renderer.render();
        
        // Request next frame
        requestAnimationFrame(() => this.gameLoop());
    }

    private showError(message: string): void {
        this.loadingScreen.style.display = 'none';
        this.errorScreen.textContent = message;
        this.errorScreen.style.display = 'block';
    }

    public shutdown(): void {
        this.isRunning = false;
        this.gameEngine?.shutdown();
        this.audioManager?.shutdown();
        this.networkManager?.shutdown();
    }
}

// Initialize the game when the page loads
window.addEventListener('load', () => {
    const game = new QuadraWeb();
    game.initialize().catch(error => {
        console.error('Game initialization failed:', error);
    });

    // Handle page unload
    window.addEventListener('beforeunload', () => {
        game.shutdown();
    });
}); 