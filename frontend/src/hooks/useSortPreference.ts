import { useState, useEffect, useCallback } from "react";

export type SortField = "name" | "date";
export type SortDirection = "asc" | "desc";

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

interface UseSortPreferenceOptions {
  storageKey: string;
  defaultField?: SortField;
  defaultDirection?: SortDirection;
}

interface UseSortPreferenceResult {
  sortField: SortField;
  sortDirection: SortDirection;
  cycleSort: () => void;
  sortData: <T>(
    data: T[],
    getDateValue: (item: T) => string | null | undefined,
    getNameValue: (item: T) => string,
  ) => T[];
}

/**
 * Hook for managing sort preferences with localStorage persistence.
 * Cycles through: name asc → name desc → date asc → date desc
 */
export function useSortPreference({
  storageKey,
  defaultField = "date",
  defaultDirection = "desc",
}: UseSortPreferenceOptions): UseSortPreferenceResult {
  // Load initial state from localStorage
  const [sortState, setSortState] = useState<SortState>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as SortState;
        // Validate the stored values
        if (
          (parsed.field === "name" || parsed.field === "date") &&
          (parsed.direction === "asc" || parsed.direction === "desc")
        ) {
          return parsed;
        }
      }
    } catch (error) {
      console.error("Failed to load sort preference:", error);
    }
    return { field: defaultField, direction: defaultDirection };
  });

  // Persist to localStorage whenever sort state changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sortState));
    } catch (error) {
      console.error("Failed to save sort preference:", error);
    }
  }, [storageKey, sortState]);

  // Cycle through sort states
  const cycleSort = useCallback(() => {
    setSortState((prev) => {
      // Cycle order: name asc → name desc → date asc → date desc
      if (prev.field === "name" && prev.direction === "asc") {
        return { field: "name", direction: "desc" };
      }
      if (prev.field === "name" && prev.direction === "desc") {
        return { field: "date", direction: "asc" };
      }
      if (prev.field === "date" && prev.direction === "asc") {
        return { field: "date", direction: "desc" };
      }
      // date desc → name asc (back to start)
      return { field: "name", direction: "asc" };
    });
  }, []);

  // Generic sort function
  const sortData = useCallback(
    <T>(
      data: T[],
      getDateValue: (item: T) => string | null | undefined,
      getNameValue: (item: T) => string,
    ): T[] => {
      const sorted = [...data];

      if (sortState.field === "date") {
        sorted.sort((a, b) => {
          const dateA = getDateValue(a);
          const dateB = getDateValue(b);

          // Handle nulls - push them to the end regardless of direction
          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;

          const timeA = new Date(dateA).getTime();
          const timeB = new Date(dateB).getTime();

          return sortState.direction === "asc" ? timeA - timeB : timeB - timeA;
        });
      } else {
        // Sort by name
        sorted.sort((a, b) => {
          const nameA = getNameValue(a).toLowerCase();
          const nameB = getNameValue(b).toLowerCase();

          return sortState.direction === "asc"
            ? nameA.localeCompare(nameB)
            : nameB.localeCompare(nameA);
        });
      }

      return sorted;
    },
    [sortState],
  );

  return {
    sortField: sortState.field,
    sortDirection: sortState.direction,
    cycleSort,
    sortData,
  };
}
