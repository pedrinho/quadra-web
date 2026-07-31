export interface AudioClip {
    id: string;
    buffer: AudioBuffer;
    volume: number;
}

export class AudioManager {
    private audioContext: AudioContext | null = null;
    private audioClips: Map<string, AudioClip> = new Map();
    private masterVolume: number = 1.0;
    private isInitialized: boolean = false;

    constructor() {
        console.log('AudioManager created');
    }

    async initialize(): Promise<void> {
        console.log('Initializing AudioManager...');
        
        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            
            // Resume audio context if suspended
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            this.isInitialized = true;
            console.log('AudioManager initialized');
        } catch (error) {
            console.error('Failed to initialize AudioManager:', error);
            throw error;
        }
    }

    async loadAudioClip(id: string, url: string, volume: number = 1.0): Promise<void> {
        if (!this.audioContext) {
            throw new Error('AudioContext not initialized');
        }

        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            this.audioClips.set(id, {
                id,
                buffer: audioBuffer,
                volume: volume
            });
            
            console.log(`Audio clip loaded: ${id}`);
        } catch (error) {
            console.error(`Failed to load audio clip ${id}:`, error);
            throw error;
        }
    }

    playSound(id: string, volume?: number): void {
        if (!this.audioContext || !this.isInitialized) {
            console.warn('AudioManager not initialized, cannot play sound');
            return;
        }

        const clip = this.audioClips.get(id);
        if (!clip) {
            console.warn(`Audio clip not found: ${id}`);
            return;
        }

        try {
            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();
            
            source.buffer = clip.buffer;
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            // Set volume
            const finalVolume = (volume !== undefined ? volume : clip.volume) * this.masterVolume;
            gainNode.gain.value = finalVolume;
            
            source.start(0);
            console.log(`Playing sound: ${id}`);
        } catch (error) {
            console.error(`Failed to play sound ${id}:`, error);
        }
    }

    playMusic(id: string, loop: boolean = true, volume?: number): void {
        if (!this.audioContext || !this.isInitialized) {
            console.warn('AudioManager not initialized, cannot play music');
            return;
        }

        const clip = this.audioClips.get(id);
        if (!clip) {
            console.warn(`Audio clip not found: ${id}`);
            return;
        }

        try {
            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();
            
            source.buffer = clip.buffer;
            source.loop = loop;
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            // Set volume
            const finalVolume = (volume !== undefined ? volume : clip.volume) * this.masterVolume;
            gainNode.gain.value = finalVolume;
            
            source.start(0);
            console.log(`Playing music: ${id} (loop: ${loop})`);
        } catch (error) {
            console.error(`Failed to play music ${id}:`, error);
        }
    }

    setMasterVolume(volume: number): void {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        console.log(`Master volume set to: ${this.masterVolume}`);
    }

    getMasterVolume(): number {
        return this.masterVolume;
    }

    isAudioSupported(): boolean {
        return !!(window.AudioContext || (window as any).webkitAudioContext);
    }

    getInitialized(): boolean {
        return this.isInitialized;
    }

    getAudioContext(): AudioContext | null {
        return this.audioContext;
    }

    shutdown(): void {
        console.log('Shutting down AudioManager...');
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.audioClips.clear();
        this.isInitialized = false;
    }
} 