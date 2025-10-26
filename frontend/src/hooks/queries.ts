import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProfiles, getProfileFiles, getFileMetadata, updateDisplayName } from '../api'
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
 * Hook to fetch metadata for a specific file.
 * Uses cache-busting by default to ensure fresh data.
 */
export function useFileMetadata(metadataUrl: string | undefined, enabled = true) {
    return useQuery({
        queryKey: ['fileMetadata', metadataUrl],
        queryFn: () => getFileMetadata(metadataUrl!, true), // Always bust cache
        enabled: !!metadataUrl && enabled,
        staleTime: 0, // Always consider stale to ensure fresh fetches
        gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes after unused
    })
}

/**
 * Hook to fetch files with their display names resolved.
 * Fetches all metadata files and transforms data to include displayName.
 */
export function useProfileFilesWithDisplayNames(profileName: string | undefined) {
    return useQuery({
        queryKey: ['profileFilesWithDisplayNames', profileName],
        queryFn: async () => {
            if (!profileName) return []

            const files = await getProfileFiles(profileName)

            // Fetch metadata for all files in parallel
            const filesWithDisplayNames = await Promise.all(
                files.map(async (file): Promise<StemFileWithDisplayName> => {
                    try {
                        const metadata = await getFileMetadata(file.metadata_url, true)
                        return {
                            ...file,
                            displayName: metadata.display_name || file.name,
                        }
                    } catch (error) {
                        console.error(`Failed to load metadata for ${file.name}:`, error)
                        return {
                            ...file,
                            displayName: file.name,
                        }
                    }
                })
            )

            return filesWithDisplayNames
        },
        enabled: !!profileName,
        staleTime: 0, // Always fetch fresh to catch display name updates
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

            // Also invalidate the specific file's metadata
            // We need to find the metadata_url for this file
            const filesData = queryClient.getQueryData<StemFileWithDisplayName[]>([
                'profileFilesWithDisplayNames',
                variables.profileName
            ])
            const file = filesData?.find(f => f.name === variables.fileName)
            if (file) {
                queryClient.invalidateQueries({
                    queryKey: ['fileMetadata', file.metadata_url]
                })
            }
        },
    })
}