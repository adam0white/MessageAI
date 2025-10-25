/**
 * Platform-agnostic secure storage
 * 
 * Uses expo-secure-store on native platforms
 * Uses localStorage on web (with base64 encoding for consistency)
 */

import { Platform } from 'react-native';

// Lazy import to avoid bundling on web
let SecureStore: any;
if (Platform.OS !== 'web') {
	SecureStore = require('expo-secure-store');
}

export const storage = {
	async getItem(key: string): Promise<string | null> {
		if (Platform.OS === 'web') {
			// Web: use localStorage
			try {
				return localStorage.getItem(key);
			} catch (error) {
				console.error('Error getting item from localStorage:', error);
				return null;
			}
		} else {
			// Native: use SecureStore
			try {
				return await SecureStore.getItemAsync(key);
			} catch (error) {
				console.error('Error getting item from SecureStore:', error);
				return null;
			}
		}
	},

	async setItem(key: string, value: string): Promise<void> {
		if (Platform.OS === 'web') {
			// Web: use localStorage
			try {
				localStorage.setItem(key, value);
			} catch (error) {
				console.error('Error saving item to localStorage:', error);
			}
		} else {
			// Native: use SecureStore
			try {
				await SecureStore.setItemAsync(key, value);
			} catch (error) {
				console.error('Error saving item to SecureStore:', error);
			}
		}
	},

	async removeItem(key: string): Promise<void> {
		if (Platform.OS === 'web') {
			// Web: use localStorage
			try {
				localStorage.removeItem(key);
			} catch (error) {
				console.error('Error removing item from localStorage:', error);
			}
		} else {
			// Native: use SecureStore
			try {
				await SecureStore.deleteItemAsync(key);
			} catch (error) {
				console.error('Error removing item from SecureStore:', error);
			}
		}
	},
};

