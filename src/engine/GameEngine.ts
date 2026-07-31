import { Renderer } from '../renderer/Renderer';
import { InputManager } from '../input/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { NetworkManager } from '../network/NetworkManager';
import { AssetManager } from '../assets/AssetManager';

export enum GameState {
    LOADING = 'loading',
    MENU = 'menu',
    PLAYING = 'playing',
    PAUSED = 'paused'
}

export class GameEngine {
    private renderer: Renderer | null = null;
    private inputManager: InputManager | null = null;
    private audioManager: AudioManager | null = null;
    private networkManager: NetworkManager | null = null;
    private assetManager: AssetManager | null = null;
    
    private gameState: GameState = GameState.LOADING;
    private lastUpdateTime: number = 0;
    private deltaTime: number = 0;

    constructor() {
        console.log('GameEngine created');
    }

    async initialize(): Promise<void> {
        console.log('Initializing GameEngine...');
        this.gameState = GameState.LOADING;
        this.lastUpdateTime = performance.now();
        console.log('GameEngine initialized');
    }

    setRenderer(renderer: Renderer): void {
        this.renderer = renderer;
    }

    setInputManager(inputManager: InputManager): void {
        this.inputManager = inputManager;
    }

    setAudioManager(audioManager: AudioManager): void {
        this.audioManager = audioManager;
    }

    setNetworkManager(networkManager: NetworkManager): void {
        this.networkManager = networkManager;
    }

    setAssetManager(assetManager: AssetManager): void {
        this.assetManager = assetManager;
    }

    update(currentTime: number): void {
        // Calculate delta time
        this.deltaTime = (currentTime - this.lastUpdateTime) / 1000.0;
        this.lastUpdateTime = currentTime;

        // Update based on game state
        switch (this.gameState) {
            case GameState.LOADING:
                this.updateLoading();
                break;
            case GameState.MENU:
                this.updateMenu();
                break;
            case GameState.PLAYING:
                this.updatePlaying();
                break;
            case GameState.PAUSED:
                this.updatePaused();
                break;
        }

        // Update input
        this.inputManager?.update();
    }

    private updateLoading(): void {
        // Check if all assets are loaded
        if (this.assetManager?.getLoaded()) {
            this.gameState = GameState.MENU;
            console.log('Assets loaded, switching to menu state');
        }
    }

    private updateMenu(): void {
        // Handle menu input and logic
        // For now, just a placeholder
    }

    private updatePlaying(): void {
        // Update game logic
        // For now, just a placeholder
    }

    private updatePaused(): void {
        // Handle paused state
        // For now, just a placeholder
    }

    getGameState(): GameState {
        return this.gameState;
    }

    getDeltaTime(): number {
        return this.deltaTime;
    }

    shutdown(): void {
        console.log('Shutting down GameEngine...');
        this.gameState = GameState.LOADING;
    }
} 