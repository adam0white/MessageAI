/**
 * App Layout
 * 
 * Protected routes that require authentication
 * Also handles network monitoring and offline sync
 */

import React, { useEffect, useRef } from 'react';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { Redirect, Stack } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useNetworkMonitor } from '../../hooks/useNetworkMonitor';
import { useAuthStore } from '../../lib/stores/auth';
import { useGlobalMessages } from '../../hooks/useGlobalMessages';
import { config } from '../../lib/config';

const WORKER_URL = config.workerUrl;

export default function AppLayout() {
	const { isSignedIn, isLoaded, userId } = useAuth();
	const { user } = useUser();
	const { setUser, clearUser } = useAuthStore();
	const hasSyncedProfile = useRef(false);

	// Sync Clerk auth state to Zustand store
	useEffect(() => {
		if (isSignedIn && userId) {
			setUser(userId);
		} else {
			clearUser();
		}
	}, [isSignedIn, userId, setUser, clearUser]);

	// Sync user profile to backend on app load (once per session)
	useEffect(() => {
		if (isSignedIn && user && !hasSyncedProfile.current) {
			hasSyncedProfile.current = true;
			
			// Sync profile to backend (no webhook dependency)
			fetch(`${WORKER_URL}/api/users/sync`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					clerkId: user.id,
					email: user.emailAddresses[0]?.emailAddress || '',
					firstName: user.firstName || undefined,
					lastName: user.lastName || undefined,
					imageUrl: user.imageUrl,
				}),
			}).catch(() => {
				// Silently fail - will retry on next app load
			});
		}
	}, [isSignedIn, user]);

	// Monitor network connectivity and sync offline messages
	useNetworkMonitor();

	// Listen for messages from all conversations and show local notifications
	useGlobalMessages();

	if (!isLoaded) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
				<ActivityIndicator size="large" color="#007AFF" />
			</View>
		);
	}

	if (!isSignedIn) {
		return <Redirect href="/auth/sign-in" />;
	}

	return (
		<Stack
			screenOptions={{
				headerStyle: {
					backgroundColor: '#007AFF',
				},
				headerTintColor: '#fff',
				headerTitleStyle: {
					fontWeight: 'bold',
				},
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					title: 'Messages',
				}}
			/>
		</Stack>
	);
}

