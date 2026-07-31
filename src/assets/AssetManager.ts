export interface Asset {
    id: string;
    type: 'image' | 'audio' | 'font' | 'data';
    data: any;
    loaded: boolean;
    error?: string;
}

export class AssetManager {
    private assets: Map<string, Asset> = new Map();
    private loadingPromises: Promise<void>[] = [];
    private isLoaded: boolean = false;

    constructor() {
        console.log('AssetManager created');
    }

    async initialize(): Promise<void> {
        console.log('Initializing AssetManager...');
        
        // Load essential assets
        await this.loadEssentialAssets();
        
        this.isLoaded = true;
        console.log('AssetManager initialized');
    }

    private async loadEssentialAssets(): Promise<void> {
        // Load basic assets needed for the game to start
        // For now, just a placeholder
        console.log('Loading essential assets...');
    }

    async loadImage(id: string, url: string): Promise<void> {
        const promise = new Promise<void>((resolve, reject) => {
            const img = new Image();
            
            img.onload = () => {
                this.assets.set(id, {
                    id,
                    type: 'image',
                    data: img,
                    loaded: true
                });
                console.log(`Image loaded: ${id}`);
                resolve();
            };
            
            img.onerror = () => {
                const error = `Failed to load image: ${url}`;
                console.error(error);
                this.assets.set(id, {
                    id,
                    type: 'image',
                    data: null,
                    loaded: false,
                    error
                });
                reject(new Error(error));
            };
            
            img.src = url;
        });

        this.loadingPromises.push(promise);
        return promise;
    }

    async loadAudio(id: string, url: string): Promise<void> {
        const promise = new Promise<void>((resolve, reject) => {
            const audio = new Audio();
            
            audio.oncanplaythrough = () => {
                this.assets.set(id, {
                    id,
                    type: 'audio',
                    data: audio,
                    loaded: true
                });
                console.log(`Audio loaded: ${id}`);
                resolve();
            };
            
            audio.onerror = () => {
                const error = `Failed to load audio: ${url}`;
                console.error(error);
                this.assets.set(id, {
                    id,
                    type: 'audio',
                    data: null,
                    loaded: false,
                    error
                });
                reject(new Error(error));
            };
            
            audio.src = url;
            audio.load();
        });

        this.loadingPromises.push(promise);
        return promise;
    }

    async loadFont(id: string, url: string): Promise<void> {
        const promise = new Promise<void>((resolve, reject) => {
            // For now, just mark as loaded
            // TODO: Implement proper font loading
            this.assets.set(id, {
                id,
                type: 'font',
                data: null,
                loaded: true
            });
            console.log(`Font loaded: ${id}`);
            resolve();
        });

        this.loadingPromises.push(promise);
        return promise;
    }

    async loadData(id: string, url: string): Promise<void> {
        const promise = fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.text();
            })
            .then(data => {
                this.assets.set(id, {
                    id,
                    type: 'data',
                    data,
                    loaded: true
                });
                console.log(`Data loaded: ${id}`);
            })
            .catch(error => {
                const errorMsg = `Failed to load data: ${url}`;
                console.error(errorMsg, error);
                this.assets.set(id, {
                    id,
                    type: 'data',
                    data: null,
                    loaded: false,
                    error: errorMsg
                });
                throw error;
            });

        this.loadingPromises.push(promise);
        return promise;
    }

    getAsset(id: string): Asset | undefined {
        return this.assets.get(id);
    }

    getImage(id: string): HTMLImageElement | null {
        const asset = this.assets.get(id);
        if (asset && asset.type === 'image' && asset.loaded) {
            return asset.data as HTMLImageElement;
        }
        return null;
    }

    getAudio(id: string): HTMLAudioElement | null {
        const asset = this.assets.get(id);
        if (asset && asset.type === 'audio' && asset.loaded) {
            return asset.data as HTMLAudioElement;
        }
        return null;
    }

    getData(id: string): string | null {
        const asset = this.assets.get(id);
        if (asset && asset.type === 'data' && asset.loaded) {
            return asset.data as string;
        }
        return null;
    }

    isAssetLoaded(id: string): boolean {
        const asset = this.assets.get(id);
        return asset ? asset.loaded : false;
    }

    getLoaded(): boolean {
        return this.isLoaded && this.loadingPromises.length === 0;
    }

    getLoadingProgress(): number {
        if (this.loadingPromises.length === 0) {
            return 1.0;
        }
        
        const loadedAssets = Array.from(this.assets.values()).filter(asset => asset.loaded).length;
        const totalAssets = this.assets.size;
        
        return totalAssets > 0 ? loadedAssets / totalAssets : 0;
    }

    async waitForAllAssets(): Promise<void> {
        if (this.loadingPromises.length > 0) {
            await Promise.all(this.loadingPromises);
        }
    }

    clearAssets(): void {
        this.assets.clear();
        this.loadingPromises = [];
        this.isLoaded = false;
    }
} 