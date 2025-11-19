import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiProfilesProfileNameLocationsGetProfileLocationsOptions,
  apiProfilesProfileNameLocationsGetProfileLocationsQueryKey,
  apiProfilesProfileNameLocationsCreateLocationMutation,
} from "@/api/generated/@tanstack/react-query.gen";

export function useProfileLocations(profileName: string | undefined) {
  const options = apiProfilesProfileNameLocationsGetProfileLocationsOptions({
    path: { profile_name: profileName! },
  });
  return useQuery({
    ...options,
    enabled: !!profileName,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateLocation() {
  const queryClient = useQueryClient();
  const mutationOptions =
    apiProfilesProfileNameLocationsCreateLocationMutation();

  return useMutation({
    ...mutationOptions,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: apiProfilesProfileNameLocationsGetProfileLocationsQueryKey({
          path: { profile_name: variables.path.profile_name },
        }),
      });
    },
  });
}
