export class Renderer {
    private canvas: HTMLCanvasElement;
    private gl: WebGLRenderingContext | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private useWebGL: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    async initialize(): Promise<void> {
        console.log('Initializing Renderer...');
        
        // Try WebGL first, fallback to Canvas 2D
        this.gl = this.canvas.getContext('webgl') as WebGLRenderingContext || 
                  this.canvas.getContext('experimental-webgl') as WebGLRenderingContext;
        
        if (this.gl) {
            this.useWebGL = true;
            this.initializeWebGL();
            console.log('WebGL initialized');
        } else {
            this.ctx = this.canvas.getContext('2d');
            if (!this.ctx) {
                throw new Error('Neither WebGL nor Canvas 2D context available');
            }
            this.initializeCanvas2D();
            console.log('Canvas 2D initialized');
        }
    }

    private initializeWebGL(): void {
        if (!this.gl) return;

        // Set clear color to black
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        
        // Enable depth testing
        this.gl.enable(this.gl.DEPTH_TEST);
        
        // Set viewport
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    private initializeCanvas2D(): void {
        if (!this.ctx) return;

        // Set canvas properties
        this.ctx.imageSmoothingEnabled = false; // Pixel-perfect rendering
    }

    render(): void {
        if (this.useWebGL) {
            this.renderWebGL();
        } else {
            this.renderCanvas2D();
        }
    }

    private renderWebGL(): void {
        if (!this.gl) return;

        // Clear the canvas
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        
        // For now, just clear to black
        // TODO: Implement actual rendering
    }

    private renderCanvas2D(): void {
        if (!this.ctx) return;

        // Clear the canvas
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // For now, just clear to black
        // TODO: Implement actual rendering
    }

    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    getWebGLContext(): WebGLRenderingContext | null {
        return this.gl;
    }

    getCanvas2DContext(): CanvasRenderingContext2D | null {
        return this.ctx;
    }

    isWebGL(): boolean {
        return this.useWebGL;
    }

    resize(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;
        
        if (this.gl) {
            this.gl.viewport(0, 0, width, height);
        }
    }
} 