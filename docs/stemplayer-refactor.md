# StemPlayer refactor

Our StemPlayer / useStemPlayer approach is good -- we're leaning into modern React
paradigms -- but I've recently run into a challenging situation that I'm finding almost
impossible to resolve.

## Bug: effects configs being shared

The issue is that currently, our effects configs ("settings") are overwriting each
other whenever we switch from Recording A to Recording B. What happens? It's simple:

1. Recording A is loaded. 
2. `useSettings` provides a function to grab the saved recording state.
3. The saved recording state's config is passed into `useAudioEffects`.
4. That state is read out using `getCurrentEffectsConfig` in a `useEffect` that is
fired by many different changes -- for example, the change of `isLoading`
5. When `isLoading` changes to true, we attempt to save the current state.
6. Recording B is loaded.

Crucially, _there is nothing that reloads the settings for Recording B_. as such,
when it fully loads, the cached effects configs (from Recording A) are instantly
saved to Recording B. We never see B's config, and we can never see it, because we
overwrite it before reading it.

## Observations

1. We are passing around a _lot_ of state.
2. Building audio applications with React is difficult. Libraries like [r-audio](https://github.com/bbc/r-audio/tree/v1.2.0) exist to make the audio graph declarative, but unfortunately this library is incompatible with modern react versions.
3.

## Key insights: SSOT and Dependency Tree

We need to adhere to two fundamental properties that make React work well.

1. The first is the Single Source-of-Truth principle; whenever one piece of state can be
derived from another we must NOT pass that second bit of state.

2. The dependency graph is directed and acyclic; in fact, it's a tree of state! The whole
idea is to call callbacks passed down the tree when you want to change some bit of state
that's not yours to control.

As such, we should find a way to express our problem in terms of things that react can
understand. Importantly, we need to not be passing functions *back* from our custom hooks!
This breaks the dependency tree model -- we can only pass callbacks down to other hooks.
Hooks communicate with us by returning something different, primitive objects usually,
that change so we can observe them using e.g. `useEffect`.

## Proposed tasks

I suggest we do a few things to improve the state of this webapp and resolve the problems
we're facing:

1. The standard term for configuration / settings for effects in the audio world will be
"Configs". Let's lean into that, rather than calling them settings. No more EqSettings,
EqSettings, etc., instead we have ReverbConfig, StereoExpanderConfig, etc.

2. It's still a good idea for effects to be dumb containers that we load the _initiaL_ state
for. After we pass them the initial state, we can observe changes to their state by having
each effect.

3. Separate out the hooks that deal with user-mutable state (that comes from localstorage)
with those that deal with static information about the recording (stem names, waveform image
urls, audio urls, initial gain, etc.)

4. Don't pass around functions as return values from hooks. If at all possible, NEVER use this
approach. It's just too error-prone.

### Potential hierarchy

* useStemPlayer(profileName, recordingName) -- orchestration layer and config persistence

  * calls useRecordingMetadata(profileName, recordingName)
    * returns static information about the recording
    * each RecordingStem has a name, initialGain, audioUrl, waveformUrl

  * calls useAudioGraph(audioContext, stems, effects configs)
    * setting up the entire graph
    * what would this need to return for playback controller to do its job?
    * calls useStemAudio(RecordingStem)
        * returns the audio buffer / node for the graph
    * calls useEffect(EffectConfiguration)

  * calls usePlaybackController (maybe nested under audio graph???)
    * actual playback logic -- the current one looks pretty good

I'm not sure where useAudioEffects belongs in here, tbh.

BUT THE MOST IMPORTANT THING is that we don't EVER return functions from hooks! It's just
not going to work out long-term.

