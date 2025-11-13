import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { cn } from "@/lib/utils";
import type { FileWithStems } from "@/api/generated";
import type { SortField, SortDirection } from "@/hooks/useSortPreference";

interface RecordingsViewProps {
	files: FileWithStems[] | undefined;
	isLoading: boolean;
	error: Error | null;
	selectedFileName: string | null;
	onFileSelect: (file: FileWithStems) => void;
	onRefresh: () => void;
	getRelativeTime: (dateString: string | null | undefined) => string;
	sortField: SortField;
	sortDirection: SortDirection;
	onSortCycle: () => void;
}

export function RecordingsView({
	files,
	isLoading,
	error,
	selectedFileName,
	onFileSelect,
	onRefresh,
	getRelativeTime,
	sortField,
	sortDirection,
	onSortCycle,
}: RecordingsViewProps) {
	const sortLabel = `${sortField === "name" ? "NAME" : "DATE"} ${sortDirection === "asc" ? "↑" : "↓"}`;

	return (
		<>
			<div className="flex items-center justify-between mb-3 gap-2">
				<Button
					onClick={onSortCycle}
					variant="ghost"
					className="h-8 px-3 py-0 border border-gray-700 hover:bg-gray-700 hover:text-blue-400 hover:border-blue-400 text-xs font-semibold uppercase tracking-wider flex-1"
					title="Cycle sort order"
				>
					{sortLabel}
				</Button>
				<Button
					onClick={onRefresh}
					variant="ghost"
					size="icon"
					className="h-8 w-8 p-0 border border-gray-700 hover:bg-gray-700 hover:text-blue-400 hover:border-blue-400"
					title="Refresh recordings"
				>
					<RefreshCw className="h-4 w-4" />
				</Button>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center py-8">
					<Spinner size="md" />
				</div>
			) : error ? (
				<p className="empty-state">Error loading recordings. Try refreshing.</p>
			) : !files || files.length === 0 ? (
				<p className="empty-state">
					No processed files yet. Upload a file above or use the CLI.
				</p>
			) : (
				<ul className="list-none">
					{files.map((file) => {
						const relativeTime = getRelativeTime(file.date_recorded);
						return (
							<li
								key={file.name}
								className={cn("recording-list-item", {
									"recording-list-item-selected": selectedFileName === file.name,
								})}
								onClick={() => onFileSelect(file)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										onFileSelect(file);
									}
								}}
							>
								<span
									className={`truncate ${selectedFileName === file.name ? "font-medium" : ""}`}
								>
									{file.display_name || file.name}
								</span>
								<div className="flex items-center gap-2 flex-shrink-0">
									{relativeTime && (
										<span className="recording-time">{relativeTime}</span>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}
