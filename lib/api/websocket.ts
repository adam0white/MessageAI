/**
 * WebSocket Client Module
 * 
 * Manages WebSocket connections to the MessageAI Worker backend.
 * Features:
 * - Auto-reconnection with exponential backoff
 * - Type-safe message handling
 * - Offline message queuing
 * - Integration with network store
 */

import type { ClientMessage, ServerMessage } from './types';
import { useNetworkStore } from '../stores/network';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL || 'http://localhost:8787';

type MessageHandler = (message: ServerMessage) => void;
type ConnectionEventHandler = () => void;

interface WebSocketConfig {
	userId: string;
	conversationId: string;
}

class WebSocketClient {
	private ws: WebSocket | null = null;
	private config: WebSocketConfig | null = null;
	private messageHandlers: Set<MessageHandler> = new Set();
	private messageQueue: ClientMessage[] = [];
	
	// Connection event handlers
	private connectedHandlers: Set<ConnectionEventHandler> = new Set();
	private reconnectedHandlers: Set<ConnectionEventHandler> = new Set();
	private disconnectedHandlers: Set<ConnectionEventHandler> = new Set();
	
	// Track if this is first connection or a reconnection
	private hasConnectedBefore = false;
	
	// Reconnection state
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private baseReconnectDelay = 1000; // 1 second
	private maxReconnectDelay = 30000; // 30 seconds
	private reconnectTimeout: NodeJS.Timeout | null = null;
	private shouldReconnect = true;

	/**
	 * Connect to a conversation's WebSocket
	 */
	connect(config: WebSocketConfig): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			console.log('WebSocket already connected');
			return;
		}

		this.config = config;
		this.shouldReconnect = true;
		this.attemptConnection();
	}

	/**
	 * Attempt to establish WebSocket connection
	 */
	private attemptConnection(): void {
		if (!this.config) {
			console.error('WebSocket: No configuration provided');
			return;
		}

		const { userId, conversationId } = this.config;
		const wsBaseUrl = WORKER_URL.replace('http://', 'ws://').replace('https://', 'wss://');
		const wsUrl = `${wsBaseUrl}/conversation/${conversationId}?userId=${userId}`;
		
		useNetworkStore.getState().setWsStatus('connecting');

		try {
			this.ws = new WebSocket(wsUrl);
			this.setupEventHandlers();
		} catch (error) {
			console.error('WebSocket: Failed to create connection:', error);
			this.handleReconnect();
		}
	}

	/**
	 * Set up WebSocket event handlers
	 */
	private setupEventHandlers(): void {
		if (!this.ws) return;

	this.ws.onopen = () => {
		useNetworkStore.getState().setWsStatus('connected');
		this.reconnectAttempts = 0;
		this.flushMessageQueue();
		
		if (this.hasConnectedBefore) {
			this.reconnectedHandlers.forEach(handler => {
				try {
					handler();
				} catch (error) {
					console.error('WebSocket: Error in reconnection handler:', error);
				}
			});
		} else {
			this.hasConnectedBefore = true;
			this.connectedHandlers.forEach(handler => {
				try {
					handler();
				} catch (error) {
					console.error('WebSocket: Error in connection handler:', error);
				}
			});
		}
	};

	this.ws.onmessage = (event) => {
		try {
			const message: ServerMessage = JSON.parse(event.data);
			this.messageHandlers.forEach(handler => {
				try {
					handler(message);
				} catch (error) {
					console.error('WebSocket: Message handler error:', error);
				}
			});
		} catch (error) {
			console.error('WebSocket: Failed to parse message:', error);
		}
	};

	this.ws.onerror = (error) => {
		if (this.shouldReconnect && this.reconnectAttempts === 0) {
			console.error('WebSocket: Connection error');
		}
	};

	this.ws.onclose = (event) => {
		useNetworkStore.getState().setWsStatus('disconnected');
		
		this.disconnectedHandlers.forEach(handler => {
			try {
				handler();
			} catch (error) {
				console.error('WebSocket: Disconnection handler error:', error);
			}
		});
		
		if (this.shouldReconnect && event.code !== 1000) {
			this.handleReconnect();
		}
	};
	}

	/**
	 * Handle reconnection with exponential backoff
	 */
	private handleReconnect(): void {
		if (!this.shouldReconnect || this.reconnectAttempts >= this.maxReconnectAttempts) {
			useNetworkStore.getState().setWsStatus('disconnected');
			return;
		}

		this.reconnectAttempts++;
		const delay = Math.min(
			this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
			this.maxReconnectDelay
		);

		useNetworkStore.getState().setWsStatus('reconnecting');

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
		}

		this.reconnectTimeout = setTimeout(() => {
			this.attemptConnection();
		}, delay);
	}

	/**
	 * Send a message to the server
	 */
	send(message: ClientMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			try {
				this.ws.send(JSON.stringify(message));
			} catch (error) {
				console.error('WebSocket: Send failed:', error);
				this.messageQueue.push(message);
			}
		} else {
			this.messageQueue.push(message);
		}
	}

	private flushMessageQueue(): void {
		if (this.messageQueue.length === 0) return;
		
		const queue = [...this.messageQueue];
		this.messageQueue = [];

		queue.forEach(message => {
			this.send(message);
		});
	}

	/**
	 * Subscribe to incoming messages
	 */
	onMessage(handler: MessageHandler): () => void {
		this.messageHandlers.add(handler);
		
		// Return unsubscribe function
		return () => {
			this.messageHandlers.delete(handler);
		};
	}

	/**
	 * Subscribe to connection events (fires on first connection only)
	 */
	onConnected(handler: ConnectionEventHandler): () => void {
		this.connectedHandlers.add(handler);
		
		// Return unsubscribe function
		return () => {
			this.connectedHandlers.delete(handler);
		};
	}

	/**
	 * Subscribe to reconnection events (fires on every reconnection)
	 */
	onReconnected(handler: ConnectionEventHandler): () => void {
		this.reconnectedHandlers.add(handler);
		
		// Return unsubscribe function
		return () => {
			this.reconnectedHandlers.delete(handler);
		};
	}

	/**
	 * Subscribe to disconnection events
	 */
	onDisconnected(handler: ConnectionEventHandler): () => void {
		this.disconnectedHandlers.add(handler);
		
		// Return unsubscribe function
		return () => {
			this.disconnectedHandlers.delete(handler);
		};
	}

	/**
	 * Disconnect from WebSocket
	 */
	disconnect(): void {
		this.shouldReconnect = false;
		this.hasConnectedBefore = false; // Reset for next connection
		
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		if (this.ws) {
			this.ws.close(1000, 'Client disconnect');
			this.ws = null;
		}

		useNetworkStore.getState().setWsStatus('disconnected');
	}

	/**
	 * Get current connection state
	 */
	getState(): 'connecting' | 'open' | 'closing' | 'closed' {
		if (!this.ws) return 'closed';
		
		switch (this.ws.readyState) {
			case WebSocket.CONNECTING: return 'connecting';
			case WebSocket.OPEN: return 'open';
			case WebSocket.CLOSING: return 'closing';
			case WebSocket.CLOSED: return 'closed';
			default: return 'closed';
		}
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	/**
	 * Force reconnection attempt (useful when network returns)
	 */
	reconnect(): void {
		if (!this.config || this.isConnected()) {
			return;
		}

		this.reconnectAttempts = 0;
		this.shouldReconnect = true;
		this.attemptConnection();
	}

	clearMessageQueue(): void {
		this.messageQueue = [];
	}
}

// Singleton instance
export const wsClient = new WebSocketClient();

/**
 * React hook for WebSocket connection
 */
export function useWebSocket(config?: WebSocketConfig) {
	const connect = () => {
		if (config) {
			wsClient.connect(config);
		}
	};

	const disconnect = () => {
		wsClient.disconnect();
	};

	const send = (message: ClientMessage) => {
		wsClient.send(message);
	};

	const subscribe = (handler: MessageHandler) => {
		return wsClient.onMessage(handler);
	};

	return {
		connect,
		disconnect,
		send,
		subscribe,
		isConnected: wsClient.isConnected(),
		state: wsClient.getState(),
	};
}

