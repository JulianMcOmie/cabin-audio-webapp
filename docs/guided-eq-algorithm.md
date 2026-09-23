# Guided EQ: first algorithm prototype

The earlier conversation sketch is silent. The live implementation is now at
`/guided-calibration`: it connects `guidedEQ.ts` to an isolated Web Audio player,
the draggable perspective stage, and a resumable session. It has not been
validated with listeners.

The fixed pilot has 20 pairs, with two independent choices and one combined-result
review per pair (60 steps). The review lets the listener audition the previous
baseline and retain it instead. Disagreements offer a retry or retaining the
baseline. Later experiments refine existing nonzero bands with frequency/bandwidth;
flat or new bands retain frequency/gain controls. At most nine bands cover three
frequency regions with shared, left-only, and right-only corrections.

Progress is stored locally. Back restores choices; editing an earlier choice
invalidates downstream judgments. The final screen plots the real per-ear response,
exports JSON, and can save a new Cabin profile without overwriting existing ones.
Only the explicit Save and use EQ action changes the active profile.

## What the algorithm is solving

The listener supplies the preference: which point on a bounded 2D surface makes
the displayed relationship sound best. There is no assumed equation converting
EQ gain into perceived height or depth. We optimize a small part of an EQ profile
at a time, using the listener's two choices as observations.

Each experiment owns one peaking band with a stable ID. A new band starts at
zero gain. Existing bands outside that experiment are frozen. The three available
surfaces are frequency/gain, frequency/bandwidth, and gain/bandwidth. Bandwidth
means octaves, converted to digital Q at the actual sample rate. Moving frequency
with bandwidth frozen therefore also updates Q slightly. The pad center preserves
the current sound, and the bounds constrain the size of each change.

A frequency/bandwidth surface is rejected if its fixed gain is nearly zero:
that would offer an adjustment with essentially no audible effect.

## One pair, two fixed arrangements

1. Snapshot the accepted EQ and create a `GuidedEQRound` with the band's bounds,
   audible stimulus ranges, channel, and parameter slice.
2. `preview(pad)` generates an ordinary `EQBand[]` for live audition. It replaces
   the target band rather than appending a filter on every pointer move.
3. Save the first choice with `choose(0, pad)`.
4. Reverse only the stimulus depth assignment. Keep the same baseline, bounds,
   and parameter mapping. Start the second pad from that same baseline, not from
   the first arrangement's selected EQ.
5. Save the second choice with `choose(1, pad)` and call `resolve()`.

The arrangement stays fixed while the sounds alternate. Camera dragging changes
only the view. Store choices by experiment and arrangement, not by visit count.

## Combining choices

Compute each chosen filter's dB response on logarithmic frequencies within the
audible stimulus ranges. Subtract the baseline filter's response. The target is
the equally weighted mean of those two **response changes**, not of slider
coordinates, center frequencies, Q values, or gains.

A bounded coarse grid followed by local refinement fits a realizable filter on
the same parameter surface to that target. The objective is mean squared response
error plus a small penalty on correction energy (0.01). This mildly favors smaller
changes. It is an approximate numerical fit, not proof of a global optimum.

Two checks can reject the proposal:

- RMS disagreement between the two chosen response changes exceeds 1 dB.
- RMS error between the average target and the fitted response exceeds 0.5 dB.

Those thresholds and the penalty are provisional. Rejection returns the unchanged
baseline and `recheck`, never a silently averaged result. Agreement returns
`candidate`, not an automatically accepted or perceptually validated correction.
Correlation alone would be insufficient: two same-shaped curves can require very
different gains. Two choices cannot establish statistical confidence or identify
which conflicting choice is wrong.

## Proposed progression and remaining integration

Start with a broad frequency/gain search for the top/bottom pair. After both
arrangements agree, try a smaller frequency/bandwidth surface on the same band,
provided its gain is nonzero. Add localized bands for top/middle and middle/bottom
only when needed. Continue with checks across the four horizontal positions.
Left/right-specific corrections must use the existing channel field; the core
does not decide which channel or band a round should modify.

The earlier 40-screen sketch counted only choices. The live 60-step pilot also
counts the review screens. This is a coverage proposal, not an established optimum;
listening data should determine how much of it can be shortened.

Implementation status and remaining validation:

1. Implemented: a temporary stereo Web Audio chain with smoothed filter updates,
   fixed conservative headroom per experiment, a limiter, and no profile writes on
   pointer movement. Stimulus position, spectrum, timing, and depth levels are
   independent of EQ. Pulses follow the audio clock. Hidden tabs pause playback.
2. Implemented: audition the reconciled candidate against its baseline before
   committing. A numerical average can sound worse than either choice.
3. Implemented: commit only a candidate the user keeps; Back edits invalidate
   dependent experiments. Still needed: systematic replay of earlier anchors
   after later changes to assess perceptual regressions.
4. Still needed: pilot repeatability. Repeat a subset from the same baseline, counterbalance
   arrangement order, and test whether the final EQ improves untrained pairs and
   ordinary music. Record spectral response, sample rate, stimulus settings,
   channel, pad bounds, and baseline revision with every response.

## Limits to keep explicit

This is preference calibration, not a measurement of an objectively correct
soundstage or a personalized HRTF. Physical elevation depends on spectral cues;
a displayed frequency-height mapping is not evidence of correct localization.
See [Spectral Weighting Underlies Perceived Sound Elevation](https://pmc.ncbi.nlm.nih.gov/articles/PMC6367479/).

A shared linear EQ applied to identical waveforms at two levels cannot change
their amplitude ratio. It can affect a listener's impression of those sounds,
but cannot independently set arbitrary gain or depth for every grid dot. The
three-level stimulus checks must not be mistaken for three independent EQ layers.

The core supports one targeted peaking band per experiment. The pilot has a fixed
band/round schedule; it does not adaptively choose experiments, combine multi-band
search surfaces, or model loudness bias. It cannot protect earlier *perceptual*
results merely by freezing their parameters. Those remain validation and algorithm
tasks, not solved by response averaging.

Filter mathematics follows the [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/).
Run the deterministic math and reconciliation tests with `npm run test:guided-eq`.
