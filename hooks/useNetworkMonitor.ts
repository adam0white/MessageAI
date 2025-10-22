/**
 * useNetworkMonitor Hook
 * 
 * Monitors network connectivity and triggers WebSocket reconnection
 */

import { useEffect, useRef } from 'react';
import * as Network from 'expo-network';
import { useNetworkStore } from '../lib/stores/network';
import { wsClient } from '../lib/api/websocket';
import { useSQLiteContext } from 'expo-sqlite';
import { getLocalOnlyMessages, updateMessageByClientId } from '../lib/db/queries';

export function useNetworkMonitor() {
	const { setNetworkStatus } = useNetworkStore();
	const db = useSQLiteContext();
	const wasOffline = useRef(false);
	const syncInProgress = useRef(false);

	useEffect(() => {
		let intervalId: NodeJS.Timeout;

		// Function to check network state
		const checkNetworkState = async () => {
			try {
				const networkState = await Network.getNetworkStateAsync();
				const isConnected = networkState.isConnected ?? false;
				const isInternetReachable = networkState.isInternetReachable;
				const isOnline = isConnected && (isInternetReachable !== false);

				// Update network store
				setNetworkStatus(isConnected, isInternetReachable);

				if (isOnline && wasOffline.current) {
					wsClient.reconnect();
					wasOffline.current = false;
				} else if (!isOnline) {
					wasOffline.current = true;
				}
			} catch (error) {
				console.error('Error checking network state:', error);
			}
		};

		// Initial check
		checkNetworkState();

		// Poll network state every 10 seconds (less aggressive)
		intervalId = setInterval(checkNetworkState, 10000);

		return () => {
			if (intervalId) {
				clearInterval(intervalId);
			}
		};
	}, [setNetworkStatus, db]);

	useEffect(() => {
		const syncOfflineMessages = async () => {
			if (syncInProgress.current) return;

			try {
				syncInProgress.current = true;
				wsClient.clearMessageQueue();
				
				const localOnlyMessages = await getLocalOnlyMessages(db);
				if (localOnlyMessages.length === 0) return;

				for (const message of localOnlyMessages) {
					if (!message.clientId) continue;

					wsClient.send({
						type: 'send_message',
						clientId: message.clientId,
						conversationId: message.conversationId,
						content: message.content,
						messageType: message.type,
						mediaUrl: message.mediaUrl,
					});
				}
			} catch (error) {
				console.error('useNetworkMonitor: Sync failed:', error);
			} finally {
				syncInProgress.current = false;
			}
		};

		const unsubscribe = wsClient.onReconnected(syncOfflineMessages);
		return unsubscribe;
	}, [db]);
}

