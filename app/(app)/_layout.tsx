/**
 * App Layout
 * 
 * Protected routes that require authentication
 * Also handles network monitoring and offline sync
 */

import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Stack } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { useNetworkMonitor } from '../../hooks/useNetworkMonitor';
import { useAuthStore } from '../../lib/stores/auth';

export default function AppLayout() {
	const { isSignedIn, isLoaded, userId } = useAuth();
	const { setUser, clearUser } = useAuthStore();

	// Sync Clerk auth state to Zustand store
	useEffect(() => {
		if (isSignedIn && userId) {
			setUser(userId);
		} else {
			clearUser();
		}
	}, [isSignedIn, userId, setUser, clearUser]);

	// Monitor network connectivity and sync offline messages
	useNetworkMonitor();

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

