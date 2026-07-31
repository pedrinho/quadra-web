import { io, Socket } from 'socket.io-client';

export interface NetworkMessage {
    type: string;
    data: any;
    timestamp: number;
}

export interface NetworkConfig {
    serverUrl: string;
    reconnectAttempts: number;
    reconnectDelay: number;
}

export class NetworkManager {
    private socket: Socket | null = null;
    private config: NetworkConfig;
    private connected: boolean = false;
    private messageHandlers: Map<string, (data: any) => void> = new Map();
    private connectionHandlers: ((connected: boolean) => void)[] = [];

    constructor(config: NetworkConfig = {
        serverUrl: 'ws://localhost:3001',
        reconnectAttempts: 5,
        reconnectDelay: 1000
    }) {
        this.config = config;
        console.log('NetworkManager created');
    }

    async initialize(): Promise<void> {
        console.log('Initializing NetworkManager...');
        
        try {
            await this.connect();
            console.log('NetworkManager initialized');
        } catch (error) {
            console.error('Failed to initialize NetworkManager:', error);
            throw error;
        }
    }

    private async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.socket = io(this.config.serverUrl, {
                    reconnection: true,
                    reconnectionAttempts: this.config.reconnectAttempts,
                    reconnectionDelay: this.config.reconnectDelay,
                    timeout: 5000
                });

                this.socket.on('connect', () => {
                    console.log('Connected to server');
                    this.connected = true;
                    this.notifyConnectionHandlers(true);
                    resolve();
                });

                this.socket.on('disconnect', () => {
                    console.log('Disconnected from server');
                    this.connected = false;
                    this.notifyConnectionHandlers(false);
                });

                this.socket.on('connect_error', (error: any) => {
                    console.error('Connection error:', error);
                    reject(error);
                });

                this.socket.on('message', (message: NetworkMessage) => {
                    this.handleMessage(message);
                });

            } catch (error) {
                console.error('Failed to create socket connection:', error);
                reject(error);
            }
        });
    }

    private handleMessage(message: NetworkMessage): void {
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
            try {
                handler(message.data);
            } catch (error) {
                console.error(`Error handling message ${message.type}:`, error);
            }
        } else {
            console.warn(`No handler for message type: ${message.type}`);
        }
    }

    sendMessage(type: string, data: any): void {
        if (!this.socket || !this.connected) {
            console.warn('Not connected to server, cannot send message');
            return;
        }

        const message: NetworkMessage = {
            type,
            data,
            timestamp: Date.now()
        };

        this.socket.emit('message', message);
    }

    onMessage(type: string, handler: (data: any) => void): void {
        this.messageHandlers.set(type, handler);
    }

    onConnectionChange(handler: (connected: boolean) => void): void {
        this.connectionHandlers.push(handler);
    }

    private notifyConnectionHandlers(connected: boolean): void {
        this.connectionHandlers.forEach(handler => {
            try {
                handler(connected);
            } catch (error) {
                console.error('Error in connection handler:', error);
            }
        });
    }

    isConnected(): boolean {
        return this.connected;
    }

    getSocket(): Socket | null {
        return this.socket;
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
    }

    shutdown(): void {
        console.log('Shutting down NetworkManager...');
        this.disconnect();
        this.messageHandlers.clear();
        this.connectionHandlers = [];
    }
} 