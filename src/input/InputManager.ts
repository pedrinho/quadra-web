export interface InputState {
    keys: { [key: string]: boolean };
    mouse: {
        x: number;
        y: number;
        buttons: { [button: number]: boolean };
    };
    touch: {
        touches: Touch[];
        isActive: boolean;
    };
}

export class InputManager {
    private canvas: HTMLCanvasElement;
    private inputState: InputState;
    private keyMap: { [key: string]: string } = {};

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.inputState = {
            keys: {},
            mouse: {
                x: 0,
                y: 0,
                buttons: {}
            },
            touch: {
                touches: [],
                isActive: false
            }
        };
        
        this.setupEventListeners();
        this.setupKeyMap();
    }

    private setupEventListeners(): void {
        // Keyboard events
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
        
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        
        // Prevent default touch behaviors
        this.canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }

    private setupKeyMap(): void {
        // Map common game keys
        this.keyMap = {
            'ArrowUp': 'up',
            'ArrowDown': 'down',
            'ArrowLeft': 'left',
            'ArrowRight': 'right',
            'Space': 'space',
            'Enter': 'enter',
            'Escape': 'escape',
            'KeyW': 'w',
            'KeyA': 'a',
            'KeyS': 's',
            'KeyD': 'd',
            'KeyZ': 'z',
            'KeyX': 'x',
            'KeyC': 'c'
        };
    }

    private handleKeyDown(event: KeyboardEvent): void {
        const key = this.keyMap[event.code] || event.code;
        this.inputState.keys[key] = true;
        this.inputState.keys[event.key.toLowerCase()] = true;
    }

    private handleKeyUp(event: KeyboardEvent): void {
        const key = this.keyMap[event.code] || event.code;
        this.inputState.keys[key] = false;
        this.inputState.keys[event.key.toLowerCase()] = false;
    }

    private handleMouseDown(event: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        this.inputState.mouse.x = event.clientX - rect.left;
        this.inputState.mouse.y = event.clientY - rect.top;
        this.inputState.mouse.buttons[event.button] = true;
    }

    private handleMouseUp(event: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        this.inputState.mouse.x = event.clientX - rect.left;
        this.inputState.mouse.y = event.clientY - rect.top;
        this.inputState.mouse.buttons[event.button] = false;
    }

    private handleMouseMove(event: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        this.inputState.mouse.x = event.clientX - rect.left;
        this.inputState.mouse.y = event.clientY - rect.top;
    }

    private handleTouchStart(event: TouchEvent): void {
        this.inputState.touch.isActive = true;
        this.inputState.touch.touches = Array.from(event.touches);
        
        if (event.touches.length > 0) {
            const rect = this.canvas.getBoundingClientRect();
            const touch = event.touches[0];
            this.inputState.mouse.x = touch.clientX - rect.left;
            this.inputState.mouse.y = touch.clientY - rect.top;
            this.inputState.mouse.buttons[0] = true;
        }
    }

    private handleTouchEnd(event: TouchEvent): void {
        this.inputState.touch.isActive = false;
        this.inputState.touch.touches = Array.from(event.touches);
        this.inputState.mouse.buttons[0] = false;
    }

    private handleTouchMove(event: TouchEvent): void {
        this.inputState.touch.touches = Array.from(event.touches);
        
        if (event.touches.length > 0) {
            const rect = this.canvas.getBoundingClientRect();
            const touch = event.touches[0];
            this.inputState.mouse.x = touch.clientX - rect.left;
            this.inputState.mouse.y = touch.clientY - rect.top;
        }
    }

    update(): void {
        // Update input state if needed
        // For now, just a placeholder
    }

    isKeyPressed(key: string): boolean {
        return this.inputState.keys[key] || false;
    }

    isMouseButtonPressed(button: number): boolean {
        return this.inputState.mouse.buttons[button] || false;
    }

    getMousePosition(): { x: number; y: number } {
        return {
            x: this.inputState.mouse.x,
            y: this.inputState.mouse.y
        };
    }

    isTouchActive(): boolean {
        return this.inputState.touch.isActive;
    }

    getTouchCount(): number {
        return this.inputState.touch.touches.length;
    }

    getInputState(): InputState {
        return { ...this.inputState };
    }
} 