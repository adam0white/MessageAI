/**
 * Network Store
 * 
 * Tracks network connectivity and WebSocket connection status.
 */

import { create } from 'zustand';
import type { ConnectionStatus } from '../api/types';

interface NetworkState {
	// Network connectivity
	isConnected: boolean;
	isInternetReachable: boolean | null;
	
	// WebSocket connection
	wsStatus: ConnectionStatus;
	lastConnectedAt: string | null;
	
	// Actions
	setNetworkStatus: (isConnected: boolean, isInternetReachable: boolean | null) => void;
	setWsStatus: (status: ConnectionStatus) => void;
	setConnected: () => void;
	setDisconnected: () => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
	isConnected: true,
	isInternetReachable: null,
	wsStatus: 'disconnected',
	lastConnectedAt: null,

	setNetworkStatus: (isConnected, isInternetReachable) =>
		set({ isConnected, isInternetReachable }),

	setWsStatus: (wsStatus) => {
		set({ wsStatus });
		if (wsStatus === 'connected') {
			set({ lastConnectedAt: new Date().toISOString() });
		}
	},

	setConnected: () =>
		set({
			wsStatus: 'connected',
			lastConnectedAt: new Date().toISOString(),
		}),

	setDisconnected: () => set({ wsStatus: 'disconnected' }),
}));

