/**
 * Media upload handler for MessageAI
 * Handles image uploads to R2 bucket with validation and secure storage
 */

const ALLOWED_IMAGE_TYPES = [
	'image/jpeg',
	'image/jpg', 
	'image/png',
	'image/gif',
	'image/webp',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Generate a unique filename with user context
 */
function generateFilename(userId: string, originalName: string): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 10);
	const ext = originalName.split('.').pop() || 'jpg';
	return `${userId}/${timestamp}-${random}.${ext}`;
}

/**
 * Handle media upload
 */
export async function handleMediaUpload(request: Request, env: Env): Promise<Response> {
	try {
		// Validate Authorization header (Clerk token)
		const authHeader = request.headers.get('Authorization');
		if (!authHeader?.startsWith('Bearer ')) {
			return new Response(
				JSON.stringify({ error: 'Unauthorized - Bearer token required' }),
				{ status: 401, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const contentType = request.headers.get('Content-Type') || '';
		
		// Parse multipart form data
		if (!contentType.includes('multipart/form-data')) {
			return new Response(
				JSON.stringify({ error: 'Content-Type must be multipart/form-data' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const formData = await request.formData();
		const file = formData.get('file') as File | null;
		const userId = formData.get('userId') as string | null;

		if (!file) {
			return new Response(
				JSON.stringify({ error: 'No file provided' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		if (!userId) {
			return new Response(
				JSON.stringify({ error: 'userId is required' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Validate file type
		if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
			return new Response(
				JSON.stringify({ 
					error: 'Invalid file type',
					allowedTypes: ALLOWED_IMAGE_TYPES 
				}),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Validate file size
		if (file.size > MAX_FILE_SIZE) {
			return new Response(
				JSON.stringify({ 
					error: 'File too large',
					maxSize: MAX_FILE_SIZE,
					receivedSize: file.size
				}),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const filename = generateFilename(userId, file.name);
		
		const arrayBuffer = await file.arrayBuffer();
		await env.MEDIA_BUCKET.put(filename, arrayBuffer, {
			httpMetadata: {
				contentType: file.type,
			},
			customMetadata: {
				userId,
				originalName: file.name,
				uploadedAt: new Date().toISOString(),
			},
		});

		const publicUrl = `https://message.adamwhite.work/media/${filename}`;

		return new Response(
			JSON.stringify({
				success: true,
				url: publicUrl,
				filename,
				size: file.size,
				type: file.type,
			}),
			{ 
				status: 200, 
				headers: { 'Content-Type': 'application/json' } 
			}
		);
	} catch (error) {
		console.error('Media upload error:', error);
		return new Response(
			JSON.stringify({ 
				error: 'Upload failed',
				details: error instanceof Error ? error.message : 'Unknown error'
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

/**
 * Handle media retrieval from R2
 */
export async function handleMediaGet(filename: string, env: Env): Promise<Response> {
	try {
		const object = await env.MEDIA_BUCKET.get(filename);

		if (!object) {
			return new Response('Not found', { status: 404 });
		}

		// Return the file with appropriate headers
		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
		headers.set('Access-Control-Allow-Origin', '*'); // Allow CORS

		return new Response(object.body, { headers });
	} catch (error) {
		console.error('Media retrieval error:', error);
		return new Response('Internal server error', { status: 500 });
	}
}

