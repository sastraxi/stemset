import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
	useProfileSongs,
	useCreateSong,
	useProfileLocations,
	useCreateLocation,
	useUpdateRecordingMetadata,
	useRecording,
} from "@/hooks/queries";
import type { RecordingStatusResponse, FileWithStems } from "@/api/generated/types.gen";

interface MetadataPageProps {
	recording: RecordingStatusResponse | FileWithStems;
	profileId: string;
	wasInitiallyProcessing: boolean;
	onContinue?: () => void;
}

export function MetadataPage({
	recording,
	profileId,
	wasInitiallyProcessing,
	onContinue,
}: MetadataPageProps) {
	const recordingId = "recording_id" in recording ? recording.recording_id : recording.id;

	// Poll for recording status updates (every 5 seconds if processing)
	const { data: polledRecording } = useRecording(recordingId);

	// Use polled recording if available, otherwise use prop
	const currentRecording = polledRecording || recording;

	const { data: songs = [], isLoading: songsLoading } = useProfileSongs(profileId);
	const { data: locations = [], isLoading: locationsLoading } = useProfileLocations(profileId);
	const createSong = useCreateSong();
	const createLocation = useCreateLocation();
	const updateMetadata = useUpdateRecordingMetadata();

	// Local state for form values
	const [selectedSongId, setSelectedSongId] = useState<string | null>(
		"song" in recording && recording.song ? recording.song.id : null,
	);
	const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
		"location" in recording && recording.location ? recording.location.id : null,
	);
	const [selectedDate, setSelectedDate] = useState<Date | undefined>(
		"date_recorded" in recording && recording.date_recorded
			? new Date(recording.date_recorded)
			: new Date(),
	);

	// Popover open states
	const [songOpen, setSongOpen] = useState(false);
	const [locationOpen, setLocationOpen] = useState(false);
	const [dateOpen, setDateOpen] = useState(false);

	// Song search/create
	const [songSearch, setSongSearch] = useState("");
	const [locationSearch, setLocationSearch] = useState("");

	// Auto-save when values change (debounced)
	useEffect(() => {
		const timer = setTimeout(() => {
			const recordingId = "recording_id" in recording ? recording.recording_id : recording.id;
			updateMetadata.mutate({
				path: { recording_id: recordingId },
				body: {
					song_id: selectedSongId || undefined,
					location_id: selectedLocationId || undefined,
					date_recorded: selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined,
				},
			});
		}, 500);

		return () => clearTimeout(timer);
	}, [selectedSongId, selectedLocationId, selectedDate]);

	const handleCreateSong = async (name: string) => {
		const result = await createSong.mutateAsync({
			path: { profile_id: profileId },
			body: { name },
		});
		setSelectedSongId(result.id);
		setSongOpen(false);
		setSongSearch("");
	};

	const handleCreateLocation = async (name: string) => {
		const result = await createLocation.mutateAsync({
			path: { profile_id: profileId },
			body: { name },
		});
		setSelectedLocationId(result.id);
		setLocationOpen(false);
		setLocationSearch("");
	};

	const selectedSong = songs.find((s) => s.id === selectedSongId);
	const selectedLocation = locations.find((l) => l.id === selectedLocationId);

	const isProcessing = currentRecording.status === "processing";
	const isComplete = currentRecording.status === "complete";
	const showContinueButton = wasInitiallyProcessing && isComplete && onContinue;

	return (
		<div className="flex items-center justify-center min-h-screen p-4">
			<Card className="w-full max-w-2xl">
				<CardHeader>
					<div className="flex items-center gap-2">
						<CardTitle>Recording Metadata</CardTitle>
						{isProcessing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
						{isComplete && <Check className="h-4 w-4 text-green-500" />}
					</div>
					<CardDescription>
						{isProcessing && "Processing... You can add metadata while waiting."}
						{isComplete && !showContinueButton && "Edit metadata for this recording"}
						{showContinueButton && "Processing complete! Add metadata or continue to playback."}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
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
														setSelectedSongId(song.id);
														setSongOpen(false);
														setSongSearch("");
													}}
												>
													<Check
														className={cn(
															"mr-2 h-4 w-4",
															selectedSongId === song.id ? "opacity-100" : "opacity-0",
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

					{/* Location */}
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
									{selectedLocation ? selectedLocation.name : "Select location..."}
									<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-full p-0" align="start">
								<Command>
									<CommandInput
										placeholder="Search or create location..."
										value={locationSearch}
										onValueChange={setLocationSearch}
									/>
									<CommandList>
										<CommandEmpty>
											{locationSearch && (
												<Button
													variant="ghost"
													className="w-full"
													onClick={() => handleCreateLocation(locationSearch)}
													disabled={createLocation.isPending}
												>
													Create "{locationSearch}"
												</Button>
											)}
											{!locationSearch && "No locations found."}
										</CommandEmpty>
										<CommandGroup>
											{locations.map((location) => (
												<CommandItem
													key={location.id}
													value={location.name}
													onSelect={() => {
														setSelectedLocationId(location.id);
														setLocationOpen(false);
														setLocationSearch("");
													}}
												>
													<Check
														className={cn(
															"mr-2 h-4 w-4",
															selectedLocationId === location.id ? "opacity-100" : "opacity-0",
														)}
													/>
													{location.name}
												</CommandItem>
											))}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
					</div>

					{/* Date Recorded */}
					<div className="space-y-2">
						<Label htmlFor="date">Date Recorded</Label>
						<Popover open={dateOpen} onOpenChange={setDateOpen}>
							<PopoverTrigger asChild>
								<Button
									id="date"
									variant="outline"
									className={cn(
										"w-full justify-start text-left font-normal",
										!selectedDate && "text-muted-foreground",
									)}
								>
									<CalendarIcon className="mr-2 h-4 w-4" />
									{selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									mode="single"
									selected={selectedDate}
									onSelect={(date) => {
										setSelectedDate(date);
										setDateOpen(false);
									}}
									disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
									initialFocus
								/>
							</PopoverContent>
						</Popover>
					</div>

					{/* Continue Button */}
					{showContinueButton && (
						<Button onClick={onContinue} className="w-full" size="lg">
							Continue to Recording
						</Button>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
