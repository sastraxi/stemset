import { useQuery } from '@tanstack/react-query'
import { getProfiles, getProfileFiles } from '../api'

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