import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
	apiProfilesGetProfilesOptions,
	apiProfilesProfileNameFilesGetProfileFilesOptions,
	apiProfilesProfileNameFilesGetProfileFilesQueryKey,
	apiRecordingsRecordingIdGetRecordingOptions,
	apiProfilesProfileNameFilesOutputNameDisplayNameUpdateDisplayNameMutation,
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
		select: (data) =>
			data.map((file) => ({
				...file,
				displayName: file.display_name || file.name,
			})),
	});
}

export function useRecording(recordingId: string | undefined) {
	const options = apiRecordingsRecordingIdGetRecordingOptions({
		path: { recording_id: recordingId! },
	});
	return useQuery({
		...options,
		enabled: !!recordingId,
		staleTime: 60 * 1000, // 1 minute
		gcTime: 5 * 60 * 1000,
		select: (data) =>
			data ? { ...data, displayName: data.display_name || data.name } : null,
	});
}

export function useUpdateDisplayName() {
	const queryClient = useQueryClient();
	const mutationOptions =
		apiProfilesProfileNameFilesOutputNameDisplayNameUpdateDisplayNameMutation();

	return useMutation({
		...mutationOptions,
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: apiProfilesProfileNameFilesGetProfileFilesQueryKey({
					path: { profile_name: variables.path.profile_name },
				}),
			});
		},
	});
}
