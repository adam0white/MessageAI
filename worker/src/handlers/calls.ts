type Env = Cloudflare.Env;

export async function handleStartCall(
	request: Request,
	env: Env,
	conversationId: string
): Promise<Response> {
	try {
		// Verify credentials exist
		if (!env.REALTIMEKIT_ORG_ID || !env.REALTIMEKIT_API_KEY) {
			console.error('RealtimeKit credentials not configured');
			return Response.json({ 
				error: 'RealtimeKit not configured. Please set REALTIMEKIT_ORG_ID and REALTIMEKIT_API_KEY.' 
			}, { status: 500 });
		}
		
		const body = await request.json() as { 
			participants: Array<{ userId: string; userName: string }>;
			userId: string;
		};
		const participants = body.participants || [];
		const currentUserId = body.userId;
		
		// Start call for conversation
		
		// Create Basic Auth header: base64(orgId:apiKey)
		const authString = `${env.REALTIMEKIT_ORG_ID}:${env.REALTIMEKIT_API_KEY}`;
		const authHeader = `Basic ${btoa(authString)}`;
		
		// Get the Conversation DO instance
		const doId = env.CONVERSATION.idFromName(conversationId);
		const doStub = env.CONVERSATION.get(doId);
		
		// Check for existing active call
		const existingCallRes = await doStub.fetch('https://internal/active-call');
		const existingCall = await existingCallRes.json() as { meetingId?: string };
		
		let meetingId: string;
		
		if (existingCall.meetingId) {
			// Join existing meeting
			meetingId = existingCall.meetingId;
		} else {
			// Create new meeting
			const meetingRes = await fetch('https://api.realtime.cloudflare.com/v2/meetings', {
				method: 'POST',
				headers: {
					'Authorization': authHeader,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					title: `MessageAI Call - ${conversationId}`,
				}),
			});
			
			if (!meetingRes.ok) {
				const error = await meetingRes.text();
				console.error('RealtimeKit API error:', meetingRes.status, error);
				return Response.json({ 
					error: `RealtimeKit API error (${meetingRes.status}): ${error}` 
				}, { status: 500 });
			}
			
			const meetingResponse = await meetingRes.json() as { success: boolean; data: { id: string } };
			meetingId = meetingResponse.data.id;
			
			// Store meeting ID in Conversation DO
			await doStub.fetch('https://internal/active-call', {
				method: 'PUT',
				body: JSON.stringify({ meetingId }),
			});
		}
		
		// Add only the current user as a participant (others will be added when they join)
		const currentUserData = participants.find(p => p.userId === currentUserId);
		if (!currentUserData) {
			return Response.json({ 
				error: 'Current user not found in participants list' 
			}, { status: 400 });
		}
		
		// Add current user to meeting
		const res = await fetch(
			`https://api.realtime.cloudflare.com/v2/meetings/${meetingId}/participants`,
			{
				method: 'POST',
				headers: {
					'Authorization': authHeader,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					name: currentUserData.userName || currentUserId,
					preset_name: 'group_call_host',
					client_specific_id: currentUserId,
				}),
			}
		);
		
		if (!res.ok) {
			const error = await res.text();
			console.error(`Failed to add participant:`, res.status, error);
			return Response.json({ 
				error: `Failed to add participant (${res.status}): ${error}` 
			}, { status: 500 });
		}
		
		const participantResponse = await res.json() as { success: boolean; data: { token: string } };
		
		return Response.json({
			meetingId,
			authToken: participantResponse.data.token,
			isNewMeeting: !existingCall.meetingId,
		});
	} catch (error) {
		console.error('Start call error:', error);
		return Response.json({ 
			error: error instanceof Error ? error.message : 'Unknown error' 
		}, { status: 500 });
	}
}

export async function handleEndCall(
	request: Request,
	env: Env,
	conversationId: string
): Promise<Response> {
	try {
		// Get the Conversation DO instance
		const doId = env.CONVERSATION.idFromName(conversationId);
		const doStub = env.CONVERSATION.get(doId);
		
		// Clear active call
		await doStub.fetch('https://internal/active-call', {
			method: 'DELETE',
		});
		
		return Response.json({ success: true });
	} catch (error) {
		console.error('End call error:', error);
		return Response.json({ 
			error: error instanceof Error ? error.message : 'Unknown error' 
		}, { status: 500 });
	}
}

