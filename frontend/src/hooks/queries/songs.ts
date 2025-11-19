import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiProfilesProfileNameSongsGetProfileSongsByNameOptions,
  apiProfilesProfileNameSongsGetProfileSongsByNameQueryKey,
  apiProfilesProfileNameSongsCreateSongMutation,
} from "@/api/generated/@tanstack/react-query.gen";

export function useProfileSongs(profileName: string | undefined) {
  const options = apiProfilesProfileNameSongsGetProfileSongsByNameOptions({
    path: { profile_name: profileName! },
  });
  return useQuery({
    ...options,
    enabled: !!profileName,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateSong() {
  const queryClient = useQueryClient();
  const mutationOptions = apiProfilesProfileNameSongsCreateSongMutation();

  return useMutation({
    ...mutationOptions,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: apiProfilesProfileNameSongsGetProfileSongsByNameQueryKey({
          path: { profile_name: variables.path.profile_name },
        }),
      });
    },
  });
}
