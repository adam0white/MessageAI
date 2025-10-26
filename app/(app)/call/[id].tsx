import React, { useEffect } from 'react';
import { View, Text, Platform, ActivityIndicator, BackHandler } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

// Web fallback component
function WebFallback() {
	return (
		<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
			<Text style={{ fontSize: 18, textAlign: 'center' }}>
				Video calls are only available on iOS and Android.
			</Text>
			<Text style={{ fontSize: 14, color: '#666', marginTop: 10 }}>
				Please use the mobile app to join video calls.
			</Text>
		</View>
	);
}

// Native call screen
function NativeCallScreen({ authToken, conversationId }: { authToken: string; conversationId: string }) {
	const router = useRouter();
	
	// Dynamic import on native platforms only
	const { RealtimeKitProvider, useRealtimeKitClient } = require('@cloudflare/realtimekit-react-native');
	const { RtkUIProvider, RtkMeeting, RtkWaitingScreen } = require('@cloudflare/realtimekit-react-native-ui');
	
	const [meeting, initMeeting] = useRealtimeKitClient();

	useEffect(() => {
		if (authToken) {
			initMeeting({
				authToken: authToken,
				defaults: {
					audio: true,
					video: true,
				},
			});
		}
	}, [authToken]);
	
	// Handle cleanup when leaving call
	useEffect(() => {
		const cleanup = async () => {
			try {
				if (meeting) {
					// Leave the meeting
					await meeting.leaveRoom();
				}
			} catch (error) {
				console.error('Error leaving call:', error);
			}
		};
		
		// Cleanup on unmount
		return () => {
			cleanup();
		};
	}, [meeting]);
	
	// Handle Android back button
	useEffect(() => {
		if (Platform.OS === 'android') {
			const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
				router.back();
				return true;
			});
			
			return () => backHandler.remove();
		}
	}, []);

	return (
		<RealtimeKitProvider value={meeting}>
			<RtkUIProvider>
				{!meeting ? (
					<RtkWaitingScreen />
				) : (
					<RtkMeeting 
						meeting={meeting}
						showSetupScreen={true}
						iOSScreenshareEnabled={true}
					/>
				)}
			</RtkUIProvider>
		</RealtimeKitProvider>
	);
}

export default function CallScreen() {
	const { authToken, id } = useLocalSearchParams();
	const conversationId = id as string;
	
	if (Platform.OS === 'web') {
		return <WebFallback />;
	}
	
	if (!authToken || !conversationId) {
		return (
			<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
				<ActivityIndicator size="large" />
			</View>
		);
	}
	
	return <NativeCallScreen authToken={authToken as string} conversationId={conversationId} />;
}

