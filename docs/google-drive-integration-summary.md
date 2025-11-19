# Google Drive Integration: Seamless Audio Stem Separation for Collaborative Musicians

## What We Built

We've successfully implemented a comprehensive Google Drive integration for Stemset, transforming it from a manual upload-based application into a cloud-connected collaborative tool. This feature enables users to browse their Google Drive folders directly within Stemset, import audio files with a single click, and automatically process them into separated stems—all while maintaining a persistent link to the original Drive file for future updates and organization.

The implementation spans both backend and frontend, creating a complete user experience. On the backend, we leverage Google's Drive API with read-only OAuth scopes to securely access user files. The system checks which Drive files have already been imported to prevent duplicates, tracks the original source location for auditing, and triggers the existing stem separation pipeline automatically upon import. On the frontend, users encounter a new "Drive" tab in the sidebar featuring a full-fledged file browser with breadcrumb navigation, folder traversal, import status badges, and persistent navigation state that survives page refreshes.

The technical architecture follows clean separation of concerns. We refactored the frontend hooks into a modular structure with dedicated files for profiles, recordings, songs, locations, clips, and the new Drive functionality. The Drive navigator component works in both compact sidebar mode and a future full-page mode, demonstrating reusable design. Import confirmations appear in an elegant modal dialog, and upon successful import, users receive a toast notification with an embedded button to view the processing recording—giving them choice rather than forcing navigation.

Behind the scenes, the system normalizes file sources in the database with a `source_type` field distinguishing between manual uploads, local scans, and Google Drive imports. Each Drive file stores its `source_id` (the Drive file ID) and `source_parent_id` for folder context, enabling future features like sync detection when Drive files are updated. The OAuth refresh token is securely stored server-side and never exposed to the frontend, while temporary access tokens are generated on-demand for each API request.

## Three Compelling User Stories

### Story One: The Remote Rehearsal Band

The Wanderers are a five-piece band spread across three cities. Their drummer records practice sessions on her phone and immediately uploads them to their shared "Band Recordings 2024" Drive folder. The guitarist, working on arrangement ideas late at night, opens Stemset and navigates to the Drive tab. He sees this week's recordings with green checkmarks on the ones already imported and fresh files waiting to be processed. With one click, he imports "Rehearsal-Nov-19.m4a" and watches as Stemset downloads it from Drive, uploads it to cloud storage, and begins stem separation on a serverless GPU. Five minutes later, he's listening to an isolated drum track, crafting a complementary guitar part that locks into the pocket. The bassist wakes up the next morning, opens the same recording in Stemset, and mutes everything except vocals and guitar to practice her harmony parts. No file sharing via email. No "which version is this?" confusion. Just a single source of truth in Drive that the entire band can explore and process on-demand.

### Story Two: The Producer's Archive

Maria runs a small recording studio with a Google Drive folder containing five years of client sessions—over 300 audio files organized by artist and date. She's always wanted to create isolated stem libraries for remixing and practice track generation, but manually uploading and processing 300 files would take days. With the Drive integration, she opens Stemset, navigates to her "Studio Archive" folder, and sees the familiar folder structure she already maintains in Drive. She starts with an artist's subfolder, importing a dozen tracks in quick succession. Each import shows a toast notification with a "View Recording" button, so she can immediately jump to any that finish processing while continuing to browse and import others. By the end of the afternoon, she has a growing library of separated stems, each linked back to its original Drive location. When a client calls asking for an isolated vocal track from a 2022 session, she navigates Stemset's Drive browser to that year's folder, finds the file already imported with a green checkmark, and delivers the stem within minutes.

### Story Three: The Music Teacher's Practice Library

Professor Chen teaches a university jazz ensemble with a Google Drive folder of classic recordings for student practice. Each week, he uploads new songs, and students access them through Stemset's Drive integration to create custom practice tracks—muting their own instrument to play along with the masters. A trumpet student imports "So What" from the Drive folder, mutes the trumpet stem, and practices Miles Davis's solo with the full rhythm section backing her. The bass student does the same with the bass stem muted. The shared Drive folder becomes their collaborative learning hub, with Stemset handling the technical magic of stem separation while maintaining the simple folder organization they already understand.

## Impact

This integration eliminates friction between cloud storage and audio processing, transforming Stemset into a natural extension of workflows musicians already use. By meeting users where their files live, we've made professional-grade stem separation as simple as browsing folders.
