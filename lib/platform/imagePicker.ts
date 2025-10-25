/**
 * Platform-agnostic image picker
 * 
 * Uses expo-image-picker on native platforms
 * Uses HTML file input on web
 */

import { Platform } from 'react-native';

// Lazy import to avoid bundling on web
let ImagePicker: any;
let ImageManipulator: any;
if (Platform.OS !== 'web') {
	ImagePicker = require('expo-image-picker');
	ImageManipulator = require('expo-image-manipulator');
}

export interface ImagePickerResult {
	canceled: boolean;
	assets?: Array<{
		uri: string;
		width: number;
		height: number;
		type?: 'image' | 'video';
		fileName?: string;
		fileSize?: number;
	}>;
}

export interface ImageManipulatorResult {
	uri: string;
	width: number;
	height: number;
}

export const MediaTypeOptions = {
	Images: 'Images' as const,
	Videos: 'Videos' as const,
	All: 'All' as const,
};

/**
 * Request media library permissions
 */
export async function requestMediaLibraryPermissionsAsync(): Promise<{ status: 'granted' | 'denied' }> {
	if (Platform.OS === 'web') {
		// Web: No permissions needed for file input
		return { status: 'granted' };
	} else {
		// Native: request permissions
		const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
		return { status: status === 'granted' ? 'granted' : 'denied' };
	}
}

/**
 * Launch image picker
 */
export async function launchImageLibraryAsync(options: {
	mediaTypes: typeof MediaTypeOptions.Images | typeof MediaTypeOptions.Videos | typeof MediaTypeOptions.All;
	allowsEditing?: boolean;
	aspect?: [number, number];
	quality?: number;
}): Promise<ImagePickerResult> {
	if (Platform.OS === 'web') {
		// Web: use HTML file input
		return new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = 'image/*';
			input.onchange = async (e) => {
				const file = (e.target as HTMLInputElement).files?.[0];
				if (!file) {
					resolve({ canceled: true });
					return;
				}

				// Create object URL (better than data URL for large files)
				const uri = URL.createObjectURL(file);
				
				// Create an image to get dimensions
				const img = new Image();
				img.onload = () => {
					resolve({
						canceled: false,
						assets: [{
							uri,
							width: img.width,
							height: img.height,
							type: 'image',
							fileName: file.name,
							fileSize: file.size,
							// Store original file for upload
							file: file,
						} as any],
					});
				};
				img.src = uri;
			};
			input.oncancel = () => {
				resolve({ canceled: true });
			};
			input.click();
		});
	} else {
		// Native: use expo-image-picker
		return await ImagePicker.launchImageLibraryAsync(options);
	}
}

/**
 * Manipulate image (resize, crop, etc.)
 */
export async function manipulateAsync(
	uri: string,
	actions: Array<{ resize?: { width?: number; height?: number } }>,
	options: { compress?: number; format?: 'jpeg' | 'png' }
): Promise<ImageManipulatorResult> {
	if (Platform.OS === 'web') {
		// Web: use Canvas API
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			
			img.onload = () => {
				const canvas = document.createElement('canvas');
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					reject(new Error('Failed to get canvas context'));
					return;
				}

				// Apply resize action
				let targetWidth = img.width;
				let targetHeight = img.height;
				
				const resizeAction = actions.find(a => a.resize);
				if (resizeAction?.resize) {
					if (resizeAction.resize.width) {
						targetWidth = resizeAction.resize.width;
						targetHeight = (img.height / img.width) * targetWidth;
					}
				}

				canvas.width = targetWidth;
				canvas.height = targetHeight;
				ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

				// Convert to Blob instead of data URL (better for upload)
				const quality = options.compress || 0.7;
				const format = options.format === 'png' ? 'image/png' : 'image/jpeg';
				
				canvas.toBlob((blob) => {
					if (!blob) {
						reject(new Error('Failed to create blob'));
						return;
					}
					
					const resultUri = URL.createObjectURL(blob);
					resolve({
						uri: resultUri,
						width: targetWidth,
						height: targetHeight,
						blob: blob, // Store blob for upload
					} as any);
				}, format, quality);
			};

			img.onerror = () => {
				reject(new Error('Failed to load image'));
			};

			img.src = uri;
		});
	} else {
		// Native: use expo-image-manipulator
		return await ImageManipulator.manipulateAsync(uri, actions, {
			compress: options.compress,
			format: options.format === 'png' 
				? ImageManipulator.SaveFormat.PNG 
				: ImageManipulator.SaveFormat.JPEG,
		});
	}
}

export const SaveFormat = {
	JPEG: 'jpeg' as const,
	PNG: 'png' as const,
};

