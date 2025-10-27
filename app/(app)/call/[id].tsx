import React, { useEffect, useState } from 'react';
import { View, Text, Platform, ActivityIndicator, BackHandler } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { config } from '../../../lib/config';
import { useAuth } from '@clerk/clerk-expo';

const WORKER_URL = config.workerUrl;

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
	
	// Handle leave call navigation
	const handleLeaveCall = () => {
		router.back();
	};

	// Handle Android back button
	useEffect(() => {
		if (Platform.OS === 'android') {
			const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
				handleLeaveCall();
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
						onLeave={handleLeaveCall}
					/>
				)}
			</RtkUIProvider>
		</RealtimeKitProvider>
	);
}

export default function CallScreen() {
	const { authToken, id } = useLocalSearchParams();
	const conversationId = id as string;
	const [callTitle, setCallTitle] = useState('Video Call');
	const { getToken } = useAuth();
	
	// Fetch conversation name for better title
	useEffect(() => {
		const fetchConversationName = async () => {
			try {
				const token = await getToken();
				const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}`, {
					headers: { 'Authorization': `Bearer ${token}` }
				});
				if (response.ok) {
					const data = await response.json();
					const conv = data.conversation;
					if (conv.name) {
						setCallTitle(conv.name);
					} else if (conv.type === 'group') {
						setCallTitle('Group Call');
					}
				}
			} catch (error) {
				// Keep default title
			}
		};
		
		if (conversationId) {
			fetchConversationName();
		}
	}, [conversationId]);
	
	if (Platform.OS === 'web') {
		return (
			<>
				<Stack.Screen options={{ title: callTitle }} />
				<WebFallback />
			</>
		);
	}
	
	if (!authToken || !conversationId) {
		return (
			<>
				<Stack.Screen options={{ title: callTitle }} />
				<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
					<ActivityIndicator size="large" />
				</View>
			</>
		);
	}
	
	return (
		<>
			<Stack.Screen options={{ title: callTitle, headerShown: false }} />
			<NativeCallScreen authToken={authToken as string} conversationId={conversationId} />
		</>
	);
}

