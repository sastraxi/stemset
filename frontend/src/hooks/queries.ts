import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
	apiProfilesGetProfilesOptions,
	apiProfilesProfileNameFilesGetProfileFilesOptions,
	apiProfilesProfileNameFilesGetProfileFilesQueryKey,
	apiRecordingsRecordingIdGetRecordingStatusOptions,
	apiProfilesProfileNameFilesOutputNameDisplayNameUpdateDisplayNameMutation,
	apiProfilesProfileIdSongsGetProfileSongsOptions,
	apiProfilesProfileIdSongsGetProfileSongsQueryKey,
	apiProfilesProfileIdSongsCreateSongMutation,
	apiProfilesProfileIdLocationsGetProfileLocationsOptions,
	apiProfilesProfileIdLocationsGetProfileLocationsQueryKey,
	apiProfilesProfileIdLocationsCreateLocationMutation,
	apiRecordingsRecordingIdMetadataUpdateRecordingMetadataMutation,
	apiClipsClipIdUpdateClipEndpointMutation,
	apiClipsClipIdDeleteClipEndpointMutation,
} from "../api/generated/@tanstack/react-query.gen";

export function useProfiles() {
	return useQuery({
		...apiProfilesGetProfilesOptions(),
		staleTime: 5 * 60 * 1000, // 5 minutes
		refetchInterval: 5 * 1000, // Refetch every 5 seconds to check backend connection
		refetchIntervalInBackground: false,
	});
}

export function useProfileFiles(profileName: string | undefined) {
	const options = apiProfilesProfileNameFilesGetProfileFilesOptions({
		path: { profile_name: profileName! },
	});
	return useQuery({
		...options,
		enabled: !!profileName,
		staleTime: 30 * 1000, // 30 seconds
	});
}

export function useRecording(recordingId: string | undefined) {
	const options = apiRecordingsRecordingIdGetRecordingStatusOptions({
		path: { recording_id: recordingId! },
	});
	return useQuery({
		...options,
		enabled: !!recordingId,
		staleTime: 5 * 1000, // 5 seconds (allow frequent updates during processing)
		gcTime: 5 * 60 * 1000,
		refetchInterval: (query) => {
			// Poll every 5 seconds if processing, otherwise don't poll
			const data = query.state.data;
			return data && data.status === "processing" ? 5000 : false;
		},
		// Note: Removed select to avoid creating new object references on every render
		// Components can compute displayName themselves if needed
	});
}

export function useUpdateDisplayName() {
	const queryClient = useQueryClient();
	const mutationOptions =
		apiProfilesProfileNameFilesOutputNameDisplayNameUpdateDisplayNameMutation();

	return useMutation({
		...mutationOptions,
		onSuccess: (data, variables) => {
			queryClient.setQueryData(
				apiProfilesProfileNameFilesGetProfileFilesQueryKey({
					path: { profile_name: variables.path.profile_name },
				}),
				(oldData: any) => {
					if (!oldData) return oldData;

					// Only create new array if the file exists and display_name actually changed
					const fileIndex = oldData.findIndex((file: any) => file.name === variables.path.output_name);
					if (fileIndex === -1) return oldData;

					const oldFile = oldData[fileIndex];
					if (oldFile.display_name === data.display_name) return oldData;

					// Create new array with updated file
					const newData = [...oldData];
					newData[fileIndex] = { ...oldFile, display_name: data.display_name };
					return newData;
				}
			);
		},
	});
}

export function useProfileSongs(profileId: string | undefined) {
	const options = apiProfilesProfileIdSongsGetProfileSongsOptions({
		path: { profile_id: profileId! },
	});
	return useQuery({
		...options,
		enabled: !!profileId,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});
}

export function useCreateSong() {
	const queryClient = useQueryClient();
	const mutationOptions = apiProfilesProfileIdSongsCreateSongMutation();

	return useMutation({
		...mutationOptions,
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: apiProfilesProfileIdSongsGetProfileSongsQueryKey({
					path: { profile_id: variables.path.profile_id },
				}),
			});
		},
	});
}

export function useProfileLocations(profileId: string | undefined) {
	const options = apiProfilesProfileIdLocationsGetProfileLocationsOptions({
		path: { profile_id: profileId! },
	});
	return useQuery({
		...options,
		enabled: !!profileId,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});
}

export function useCreateLocation() {
	const queryClient = useQueryClient();
	const mutationOptions = apiProfilesProfileIdLocationsCreateLocationMutation();

	return useMutation({
		...mutationOptions,
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: apiProfilesProfileIdLocationsGetProfileLocationsQueryKey({
					path: { profile_id: variables.path.profile_id },
				}),
			});
		},
	});
}

export function useUpdateRecordingMetadata() {
	const queryClient = useQueryClient();
	const mutationOptions = apiRecordingsRecordingIdMetadataUpdateRecordingMetadataMutation();

	return useMutation({
		...mutationOptions,
		onSuccess: () => {
			// Invalidate all recordings queries to refresh the metadata
			queryClient.invalidateQueries({
				queryKey: ["api", "recordings"],
			});
			queryClient.invalidateQueries({
				queryKey: ["api", "profiles"],
			});
		},
	});
}

export function useUpdateClip() {
	const queryClient = useQueryClient();
	const mutationOptions = apiClipsClipIdUpdateClipEndpointMutation();

	return useMutation({
		...mutationOptions,
		onSuccess: () => {
			// Invalidate clips and profiles queries to refresh the metadata
			queryClient.invalidateQueries({
				queryKey: ["api", "clips"],
			});
			queryClient.invalidateQueries({
				queryKey: ["api", "profiles"],
			});
		},
	});
}

export function useDeleteClip() {
	const queryClient = useQueryClient();
	const mutationOptions = apiClipsClipIdDeleteClipEndpointMutation();

	return useMutation({
		...mutationOptions,
		onSuccess: () => {
			// Invalidate clips and profiles queries to refresh the list
			queryClient.invalidateQueries({
				queryKey: ["api", "clips"],
			});
			queryClient.invalidateQueries({
				queryKey: ["api", "profiles"],
			});
		},
	});
}
