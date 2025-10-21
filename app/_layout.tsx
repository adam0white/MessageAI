/**
 * Root Layout
 * 
 * Sets up:
 * - Clerk authentication provider
 * - React Query for server state
 * - Database initialization  
 * - Navigation structure
 */

import { ClerkProvider, ClerkLoaded } from '@clerk/clerk-expo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { initializeDatabase } from '../lib/db';
import React from 'react';

// Create a client
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 2,
			staleTime: 1000 * 60 * 5, // 5 minutes
		},
	},
});

// Clerk publishable key - you'll need to add this to your .env
const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '';

/**
 * Token cache for Clerk using Expo Secure Store
 */
const tokenCache = {
	async getToken(key: string) {
		try {
			return await SecureStore.getItemAsync(key);
		} catch (error) {
			console.error('Error getting token:', error);
			return null;
		}
	},
	async saveToken(key: string, value: string) {
		try {
			return await SecureStore.setItemAsync(key, value);
		} catch (error) {
			console.error('Error saving token:', error);
		}
	},
};

export default function RootLayout() {
	const [isDbReady, setIsDbReady] = useState(false);
	const [dbError, setDbError] = useState<string | null>(null);

	useEffect(() => {
		async function setupDatabase() {
			try {
				await initializeDatabase();
				setIsDbReady(true);
			} catch (error) {
				console.error('Failed to initialize database:', error);
				setDbError(error instanceof Error ? error.message : 'Unknown error');
			}
		}

		setupDatabase();
	}, []);

	if (!CLERK_PUBLISHABLE_KEY) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
				<Text style={{ fontSize: 16, color: 'red', textAlign: 'center' }}>
					Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
				</Text>
				<Text style={{ fontSize: 14, color: '#666', marginTop: 10, textAlign: 'center' }}>
					Please add your Clerk publishable key to .env
				</Text>
			</View>
		);
	}

	if (dbError) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
				<Text style={{ fontSize: 16, color: 'red', textAlign: 'center' }}>
					Database initialization failed
				</Text>
				<Text style={{ fontSize: 14, color: '#666', marginTop: 10, textAlign: 'center' }}>
					{dbError}
				</Text>
			</View>
		);
	}

	if (!isDbReady) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
				<ActivityIndicator size="large" color="#007AFF" />
				<Text style={{ marginTop: 10, color: '#666' }}>Initializing database...</Text>
			</View>
		);
	}

	return (
		<ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
			<ClerkLoaded>
				<QueryClientProvider client={queryClient}>
					<Slot />
				</QueryClientProvider>
			</ClerkLoaded>
		</ClerkProvider>
	);
}

