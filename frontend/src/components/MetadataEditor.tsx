import { format } from "date-fns";
import { Check, ChevronDown, ChevronsUpDown, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	useCreateSong,
	useProfileSongs,
} from "@/hooks/queries";
import { cn } from "@/lib/utils";

interface MetadataEditorProps {
	profileId: string;
	displayName: string;
	selectedSongId: string | null;
	selectedLocationName: string | null;
	selectedDate: Date | undefined;
	onDisplayNameChange: (value: string) => void;
	onSongChange: (songId: string | null) => void;
	onLocationChange: (locationName: string | null) => void;
	onDateChange: (date: Date | undefined) => void;
	onSave: () => void;
	onCancel: () => void;
	onDelete?: () => void;
	isDeleting?: boolean;
}

export function MetadataEditor({
	profileId,
	displayName,
	selectedSongId,
	selectedLocationName,
	selectedDate,
	onDisplayNameChange,
	onSongChange,
	onLocationChange,
	onDateChange,
	onSave,
	onCancel,
	onDelete,
	isDeleting = false,
}: MetadataEditorProps) {
	const { data: songs = [] } = useProfileSongs(profileId);
	const createSong = useCreateSong();

	// Popover open states
	const [songOpen, setSongOpen] = useState(false);
	const [deleteDropdownOpen, setDeleteDropdownOpen] = useState(false);
	const [deleteCountdown, setDeleteCountdown] = useState<number | null>(null);

	// Song search
	const [songSearch, setSongSearch] = useState("");

	// LocationIQ location search state
	const [locationSearch, setLocationSearch] = useState("");
	const [locationResults, setLocationResults] = useState<
		Array<{
			place_id: string;
			display_name: string;
			address: { state?: string; country?: string };
		}>
	>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [locationOpen, setLocationOpen] = useState(false);

	const handleCreateSong = async (name: string) => {
		const result = await createSong.mutateAsync({
			path: { profile_id: profileId },
			body: { name },
		});
		onSongChange(result.id);
		setSongOpen(false);
		setSongSearch("");
	};

	const handleAutoGenerateTitle = () => {
		const selectedSong = songs.find((s) => s.id === selectedSongId);
		const datePart = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "YYYY-MM-DD";
		const songPart = selectedSong ? selectedSong.name : "Song Name";
		const locationPart = selectedLocationName || "Location";
		const generated = `${datePart} - ${songPart} (${locationPart})`;
		onDisplayNameChange(generated);
	};

	// Debounced location search
	useEffect(() => {
		if (locationSearch.length < 3) {
			setLocationResults([]);
			return;
		}

		setIsSearching(true);

		// Debounce: wait 500ms after user stops typing
		const timer = setTimeout(async () => {
			try {
				const apiKey = import.meta.env.VITE_LOCATIONIQ_ACCESS_TOKEN;

				if (!apiKey) {
					console.warn("LocationIQ API key not configured, search disabled");
					setLocationResults([]);
					setIsSearching(false);
					return;
				}

				const response = await fetch(
					`https://us1.locationiq.com/v1/search?format=json&q=${encodeURIComponent(locationSearch)}&limit=8&addressdetails=1&key=${apiKey}`
				);

				if (!response.ok) {
					throw new Error(`LocationIQ API error: ${response.status}`);
				}

				const data = await response.json();
				setLocationResults(data);
			} catch (error) {
				console.error("Location search failed:", error);
				setLocationResults([]);
			} finally {
				setIsSearching(false);
			}
		}, 500);

		return () => clearTimeout(timer);
	}, [locationSearch]);

	const selectedSong = songs.find((s) => s.id === selectedSongId);

	// Delete countdown effect
	useEffect(() => {
		if (deleteCountdown === null || deleteCountdown <= 0) return;

		const timer = setTimeout(() => {
			setDeleteCountdown(deleteCountdown - 1);
		}, 1000);

		return () => clearTimeout(timer);
	}, [deleteCountdown]);

	const handleDeleteClick = () => {
		setDeleteCountdown(3);
	};

	const handleConfirmDelete = () => {
		if (onDelete && deleteCountdown === 0) {
			onDelete();
			setDeleteDropdownOpen(false);
		}
	};

	return (
		<div className="metadata-editor">
			{/* Title Section with Auto-Generate */}
			<div className="metadata-editor-title-section">
				<div className="metadata-editor-title-input-group">
					<Label htmlFor="display-name">Recording Title</Label>
					<div className="metadata-editor-title-row">
						<Input
							id="display-name"
							type="text"
							value={displayName}
							onChange={(e) => onDisplayNameChange(e.target.value)}
							placeholder="Enter recording title..."
							className="flex-1"
						/>
						<Button
							type="button"
							onClick={handleAutoGenerateTitle}
							variant="outline"
							size="sm"
							title="Auto-generate from date, song, and location"
						>
							<Sparkles className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</div>

			{/* Two Column Layout */}
			<div className="metadata-editor-columns">
				{/* Left Column: Calendar / Date Input */}
				<div className="metadata-editor-calendar-column">
					<Label htmlFor="date-recorded">Date Recorded</Label>
					{/* Mobile: Native date input */}
					<Input
						id="date-recorded"
						type="date"
						value={selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""}
						onChange={(e) => {
							const newDate = e.target.value ? new Date(e.target.value) : undefined;
							onDateChange(newDate);
						}}
						max={format(new Date(), "yyyy-MM-dd")}
						min="1900-01-01"
						className="metadata-editor-date-input sm:hidden"
					/>
					{/* Desktop: Calendar */}
					<Calendar
						mode="single"
						selected={selectedDate}
						onSelect={(date) => onDateChange(date)}
						disabled={(date) =>
							date > new Date() || date < new Date("1900-01-01")
						}
						className="metadata-editor-calendar hidden sm:flex"
					/>
				</div>

				{/* Right Column: Song & Location */}
				<div className="metadata-editor-fields-column">
					{/* Song Name */}
					<div className="space-y-2">
						<Label htmlFor="song">Song Name</Label>
						<Popover open={songOpen} onOpenChange={setSongOpen}>
							<PopoverTrigger asChild>
								<Button
									id="song"
									variant="outline"
									role="combobox"
									aria-expanded={songOpen}
									className="w-full justify-between"
								>
									{selectedSong ? selectedSong.name : "Select song..."}
									<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-full p-0" align="start">
								<Command>
									<CommandInput
										placeholder="Search or create song..."
										value={songSearch}
										onValueChange={setSongSearch}
									/>
									<CommandList>
										<CommandEmpty>
											{songSearch && (
												<Button
													variant="ghost"
													className="w-full"
													onClick={() => handleCreateSong(songSearch)}
													disabled={createSong.isPending}
												>
													Create "{songSearch}"
												</Button>
											)}
											{!songSearch && "No songs found."}
										</CommandEmpty>
										<CommandGroup>
											{songs.map((song) => (
												<CommandItem
													key={song.id}
													value={song.name}
													onSelect={() => {
														onSongChange(song.id);
														setSongOpen(false);
														setSongSearch("");
													}}
												>
													<Check
														className={cn(
															"mr-2 h-4 w-4",
															selectedSongId === song.id
																? "opacity-100"
																: "opacity-0",
														)}
													/>
													{song.name}
												</CommandItem>
											))}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
					</div>

					{/* Location (LocationIQ) */}
					<div className="space-y-2">
						<Label htmlFor="location">Location</Label>
						<Popover open={locationOpen} onOpenChange={setLocationOpen}>
							<PopoverTrigger asChild>
								<Button
									id="location"
									variant="outline"
									role="combobox"
									aria-expanded={locationOpen}
									className="w-full justify-between"
								>
									{selectedLocationName || "Search for location..."}
									<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-full p-0" align="start">
								<Command shouldFilter={false}>
									<CommandInput
										placeholder="Search location..."
										value={locationSearch}
										onValueChange={setLocationSearch}
									/>
									<CommandList>
										<CommandEmpty>
											{isSearching && "Searching..."}
											{!isSearching &&
												locationSearch.length < 3 &&
												"Type at least 3 characters"}
											{!isSearching &&
												locationSearch.length >= 3 &&
												locationResults.length === 0 &&
												"No locations found"}
										</CommandEmpty>
										<CommandGroup>
											{locationResults.map((result) => {
												const stateCountry = [
													result.address?.state,
													result.address?.country,
												]
													.filter(Boolean)
													.join(", ");

												return (
													<CommandItem
														key={result.place_id}
														value={result.display_name}
														onSelect={() => {
															onLocationChange(result.display_name);
															setLocationOpen(false);
															setLocationSearch("");
														}}
														className="flex items-center justify-between"
													>
														<div className="flex items-center">
															<Check
																className={cn(
																	"mr-2 h-4 w-4",
																	selectedLocationName === result.display_name
																		? "opacity-100"
																		: "opacity-0",
																)}
															/>
															<span className="truncate max-w-[300px]">
																{result.display_name}
															</span>
														</div>
														{stateCountry && (
															<span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
																{stateCountry}
															</span>
														)}
													</CommandItem>
												);
											})}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
					</div>
				</div>
			</div>

			{/* Action Buttons */}
			<div className="metadata-editor-actions">
				{onDelete && (
					<DropdownMenu open={deleteDropdownOpen} onOpenChange={(open) => {
						setDeleteDropdownOpen(open);
						if (!open) {
							setDeleteCountdown(null);
						}
					}}>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								disabled={isDeleting}
								variant="destructive"
								className="mr-auto"
							>
								{isDeleting ? "Deleting..." : "Delete Recording"}
								<ChevronDown className="ml-2 h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-80">
							<DropdownMenuItem
								disabled={deleteCountdown !== 0}
								onSelect={(e) => {
									e.preventDefault();
									if (deleteCountdown === null) {
										handleDeleteClick();
									} else if (deleteCountdown === 0) {
										handleConfirmDelete();
									}
								}}
								className="flex flex-col items-start gap-1 p-3"
							>
								{deleteCountdown === null ? (
									<>
										<div className="font-semibold text-destructive">
											Delete this recording permanently?
										</div>
										<div className="text-xs text-muted-foreground">
											This action cannot be undone. All stems and metadata will be lost.
										</div>
									</>
								) : deleteCountdown > 0 ? (
									<>
										<div className="font-semibold text-muted-foreground">
											Ready to delete in {deleteCountdown}...
										</div>
										<div className="text-xs text-muted-foreground">
											This action cannot be undone. All stems and metadata will be lost.
										</div>
									</>
								) : (
									<>
										<div className="font-semibold text-destructive">
											Click to confirm deletion
										</div>
										<div className="text-xs text-muted-foreground">
											This action cannot be undone. All stems and metadata will be lost.
										</div>
									</>
								)}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				<Button type="button" onClick={onCancel} variant="outline">
					Cancel
				</Button>
				<Button type="button" onClick={onSave}>
					Save
				</Button>
			</div>
		</div>
	);
}
