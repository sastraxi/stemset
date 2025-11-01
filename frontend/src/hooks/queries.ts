import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProfiles, getProfileFiles, getRecording, updateDisplayName } from '../api'
import type { StemFileWithDisplayName } from '../types'

export function useProfiles() {
    return useQuery({
        queryKey: ['profiles'],
        queryFn: getProfiles,
        staleTime: 5 * 60 * 1000, // 5 minutes
        refetchInterval: 5 * 1000, // Refetch every 5 seconds to check backend connection
        refetchIntervalInBackground: false,
    })
}

export function useProfileFiles(profileName: string | undefined) {
    return useQuery({
        queryKey: ['profileFiles', profileName],
        queryFn: () => getProfileFiles(profileName!),
        enabled: !!profileName,
        staleTime: 30 * 1000, // 30 seconds
    })
}

/**
 * Hook to fetch files with their display names resolved.
 * Since the new API includes display names directly, this is simpler.
 */
export function useProfileFilesWithDisplayNames(profileName: string | undefined) {
    return useQuery({
        queryKey: ['profileFilesWithDisplayNames', profileName],
        queryFn: async () => {
            if (!profileName) return []

            const files = await getProfileFiles(profileName)

            // Transform API response to match StemFileWithDisplayName interface
            const filesWithDisplayNames: StemFileWithDisplayName[] = files.map((file): StemFileWithDisplayName => ({
                ...file,
                displayName: file.display_name || file.name,
            }))

            return filesWithDisplayNames
        },
        enabled: !!profileName,
        staleTime: 30 * 1000, // 30 seconds since data is more stable now
        gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    })
}

/**
 * Hook to fetch a single recording with stems and user config.
 * This is the primary data source when navigating to a specific recording.
 */
export function useRecording(recordingId: string | undefined) {
    return useQuery({
        queryKey: ['recording', recordingId],
        queryFn: async () => {
            if (!recordingId) return null

            const recording = await getRecording(recordingId)

            // Transform to match StemFileWithDisplayName interface
            const recordingWithDisplayName: StemFileWithDisplayName = {
                ...recording,
                displayName: recording.display_name || recording.name,
            }

            return recordingWithDisplayName
        },
        enabled: !!recordingId,
        staleTime: 60 * 1000, // 1 minute - config changes frequently
        gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    })
}

/**
 * Mutation hook to update display name.
 * Automatically invalidates relevant queries on success.
 */
export function useUpdateDisplayName() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: ({ profileName, fileName, displayName }: {
            profileName: string
            fileName: string
            displayName: string
        }) => updateDisplayName(profileName, fileName, displayName),
        onSuccess: (_data, variables) => {
            // Invalidate the files with display names query to refetch
            queryClient.invalidateQueries({
                queryKey: ['profileFilesWithDisplayNames', variables.profileName]
            })
        },
    })
}