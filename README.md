# Smart Timing for Cape's Identifier Rotation (concept)

**Live demo:** https://mohith26.github.io/cape-smart-rotation/

Unofficial concept demo by Mohith Gajjela. Not affiliated with Cape. Synthetic data.

## What it is

Cape rotates a subscriber's IMSI every 24 hours from the moment the feature is turned on, and lets people rotate by hand in high-risk moments. This concept adds a **Rotation timing** setting to the Identifier Rotation screen:

- **Every 24 hours** (today's behavior), or
- **Smart**: rotate somewhere inside a 20 to 28 hour window, at a moment when an observer can't easily tell which new Cape ID is yours: while you're moving between cells (with a short, randomized silent period), or while the phone is already offline (Metro tunnel, phone switched off).

It also adds a **Rotation privacy** screen that scores each of your recent rotations, and a check on **Rotate now** that warns you when rotating right here would be easy to link, and when your next good moment is.

## Why

Every Cape IMSI starts with the same MCC-MNC (311 588). So an observer who logs Cape-range identities per cell (a cell-site simulator, or anyone with signaling visibility but not the IMEI) does not have to choose among every phone nearby, only among the other *Cape* IDs that appear nearby. A fixed-clock rotation usually happens wherever the phone is sitting (often home at night): the old IMSI goes quiet and a fresh 311-588 IMSI attaches in the same cell 30 to 60 seconds later. In the simulation the observer's best guess is right for 98% of those rotations.

This is the mix-zone / silent-period idea from location-privacy research (Beresford and Stajano 2003; Huang et al. 2005 on silent periods for pseudonym changes) applied to carrier identifier rotation.

## How it works

`core/sim.js` builds a seeded synthetic DC-like metro: an 10 x 8 grid of 1.2 km cell sectors, 600 Cape phones with home/work routines (commutes by car or Metro, Metro tunnels with no service, evening and weekend outings, some phones switched off overnight), and a small stream of visiting Cape SIMs. Two weeks, Oct 26 to Nov 8, 2026.

`core/rotation.js`:

1. **Policies.** Fixed: rotate every 24 h from a random enable time, 30 to 60 s modem reboot. Smart: in each 20 to 28 h window, look at the moments the phone is moving between cells or already offline, and the deadline at 28 h.
2. **On-device cover estimate.** For each candidate moment, the expected number of other fresh Cape IDs an observer would have to consider, `lambda = rate x hour-of-day factor x 2 x silence x reachable cells`, and an estimated link chance `1 / (1 + lambda)`. Uses only things the phone knows (time, whether it's moving, how long it will be silent) plus a coarse density prior.
3. **When to stop: finite-horizon optimal stopping.** From the phone's own previous week, it learns how often a good moment shows up in each hour and how good it tends to be, and solves the backward induction `V[k] = p_k E[min(X, V[k+1])] + (1 - p_k) V[k+1]` over hourly bins of the window. It rotates at the first moment whose estimate beats the value of waiting.
4. **The observer (evaluation).** A passive observer sees, per cell, when a 311-588 identity goes quiet for good and when a never-seen one appears. It knows the policy: from week 1 it learns the joint distribution of (silence length, distance moved) for true old-to-new pairs, then for every week-2 rotation scores every candidate new ID within 12 hours (density per cell at that ring distance), and reports its posterior on the true successor, whether its top guess is right, and the effective number of lookalikes (exp of the posterior entropy).

## Results (seed 20261110, 600 Cape phones, rotations in Nov 2 to 8)

| Max time offline when moving | Policy | Observer's top guess right | Median lookalikes | Extra offline per rotation |
|---|---|---|---|---|
|  | Every 24 hours | 98.4% | 1.0 | 0.7 min |
| 6 min | Smart | 68.1% | 2.1 | 6.4 min |
| 12 min (default) | Smart | 40.7% | 7.1 | 7.9 min |
| 20 min | Smart | 27.9% | 15.8 | 11.8 min |

By kind (12 min preset): rotations during an existing outage are linked 10% of the time, rotations on the move 33%, and rotations forced by the 28 h deadline 91% (as bad as the fixed clock). Density matters: with 300 phones Smart is 50.5% vs 99.2%; with 1,200 it is 29.5% vs 97.4%. Every number on the page is computed in the browser from the same seeded simulation; `node scripts/generate.js` writes them to `data/summary.json`.

## Tests

```
node --test
```

Checks timelines are contiguous, the fixed clock is exactly 24 h, Smart always rotates 20 to 28 h after the last rotation, the stopping values are monotone, the linking posterior on hand-built cases (one candidate = certain, two identical = 50/50, 2 lookalikes), the cover estimate grows with silence and movement, and the headline (fixed > 95% linked, Smart < 50%, and the on-device estimate rank-correlates with the observer's result, Spearman > 0.3).

## Honest limitations

- Synthetic city, routines and Cape density. The absolute numbers depend on how many Cape phones are around you; the ranking (fixed clock worst, outage best) is the robust part.
- Cell-level observer only. It ignores IMEI (an MNO that sees the IMEI links everything regardless, as Cape's own post notes), radio fingerprinting, paging, and traffic timing. A joint-assignment adversary that solves all pairs at once would do somewhat better than this per-rotation Bayesian one.
- The Smart policy costs real connectivity: about 8 minutes offline per rotation at the default, and it can't help when the phone sits still for the whole window (deadline rotations stay linkable). A server-coordinated "rotate together" epoch would be the next lever.
- The density prior and hour-of-day factor are assumptions; in production they would come from an aggregate Cape publishes or from the device's own history.
- UI fonts are free lookalikes (Hanken Grotesk, DM Mono) for Cape's FK Grotesk; the rotation illustration is a redraw.

## Novelty note

Checked Cape's features page, blog (Identifier Rotation launch Dec 2025, paging-attack post May 2026, signaling post), the support article on Identifier Rotation (updated Sep 2026: "rotate every 24 hours from the moment you enable it"; to change the time, toggle off and on), the iPhone/Android new-features articles, Preferred Network (Sep 2026) and the App Store listing (v1.512.0, Oct 2026). None describe choosing *when* to rotate for unlinkability or scoring rotations. Multi-IMSI IoT SIMs (e.g. Eseye) rotate IMSIs for connectivity, not privacy.
