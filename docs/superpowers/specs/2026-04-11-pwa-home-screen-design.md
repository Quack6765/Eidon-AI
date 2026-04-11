# PWA Home Screen and Warrior Icon Design

## Summary

Make the app feel native when added to the iOS or Android home screen by shipping a basic installable PWA configuration and replacing the current manually cropped agent image with new warrior-face-derived assets from the existing banner artwork.

This iteration is intentionally limited to installability and visual identity. It does not add offline support, service workers, or cached application behavior.

## Goals

- Add the metadata and manifest needed for a basic installable PWA experience.
- Create a new square app icon from the warrior face in `public/eidon-banner.png`.
- Create a new in-app agent profile icon from the same source artwork with a cleaner crop than the current `public/chat-icon.png`.
- Keep the visual treatment plain: no metallic border, glow, badge, or decorative framing on the PWA icon.

## Non-Goals

- Offline support or asset/data caching.
- Background sync, push notifications, or service worker lifecycle management.
- Reworking unrelated frontend branding or layout.
- Adding ornamental icon styling beyond the crop itself.

## Current State

- The app is a Next.js application with root metadata defined in `app/layout.tsx`.
- Existing image assets include `public/eidon-banner.png` and `public/chat-icon.png`.
- The current agent profile image was manually cropped and is not composed well enough to reuse for install surfaces.
- There is no stated PWA manifest or dedicated home-screen install configuration in the current shell.

## Approach Options Considered

### 1. Manual per-asset editing

Extract and tune each final icon separately, then wire up PWA metadata manually.

Pros:
- Lowest implementation complexity.
- Maximum freedom per exported asset.

Cons:
- Two unrelated crops are harder to keep visually consistent.
- Future size refreshes require repeated manual work.

### 2. Single-source asset derivation

Extract one clean warrior portrait from the banner and derive both the PWA app icon and the in-app agent icon from that portrait, while still wiring the PWA metadata manually.

Pros:
- Consistent identity across install surfaces and the UI.
- Easier regeneration if sizes or downstream uses change.
- Keeps the PWA layer simple without adding dependency overhead.

Cons:
- Requires a little more up-front structure than ad hoc asset swaps.

### 3. Plugin-driven PWA setup

Use a helper package to scaffold PWA behavior and metadata while also replacing the icon assets.

Pros:
- Faster to scaffold if deeper PWA behavior is expected later.

Cons:
- Adds configuration and dependency weight that is unnecessary for a basic installable experience.
- Creates pressure to think about caching and service-worker behavior that is explicitly out of scope.

## Chosen Design

Use option 2 in a lightweight form: one source extraction from `public/eidon-banner.png`, then derive two plain PNG outputs from it.

The PWA layer remains manual and minimal. The app gets a manifest, icon declarations, theme/background metadata, and Apple-compatible home-screen metadata. No service worker is introduced in this iteration.

## Asset Design

### Source

`public/eidon-banner.png` is the visual source for both updated outputs.

### Derived Assets

- A new square app icon for home-screen/install use.
- A new agent profile icon for in-app use.

Both assets come from the same warrior-face extraction so the identity is consistent, but they are separate exported files because they serve different layout contexts.

### Visual Rules

- The crop should focus on the warrior face and read clearly at small sizes.
- The PWA app icon should remain plain, using only the extracted artwork without added border or effect treatments.
- The agent profile icon should also remain plain and basic, similar in spirit to the current asset but with a better crop.
- If transparency causes rendering issues, a neutral fill may be used only as a practical export aid, not as a stylistic embellishment.

## App Shell Changes

### Metadata

Update the root metadata layer around `app/layout.tsx` so the app shell declares:

- app title and description for install surfaces
- manifest reference
- icon references for standard and Apple contexts
- theme color/background color appropriate to the existing dark UI
- standalone-oriented mobile web app metadata

### Manifest

Add a manifest that defines:

- app name / short name
- start URL
- standalone display mode
- theme and background colors
- icon entries using the new square warrior-face asset at the needed sizes

The manifest can be implemented either as a static public file or a small typed metadata route. The important requirement is centralized, maintainable shell configuration rather than embedding manifest logic inside feature components.

### UI References

Replace uses of the current manually cropped agent image with the new agent profile icon wherever that profile picture is surfaced in the interface.

The PWA icon and agent icon are related assets but should not be treated as interchangeable runtime references.

## Architecture Boundaries

- Asset generation/export is isolated to the image assets and any small helper script used to produce them.
- App install behavior is isolated to shell metadata and manifest wiring.
- Feature components should only consume the updated icon asset path and should not own PWA logic.

This keeps the installable-app concern inside the shell and the visual identity concern inside assets, which avoids coupling PWA configuration to chat or settings components.

## Error Handling and Risks

The main risks are visual and integration-oriented rather than logical:

- the warrior-face crop may not read well at small icon sizes
- icon sizing or declarations may be incomplete for some install surfaces
- iOS-specific metadata may be omitted or partially configured

No new runtime caching behavior is introduced, so there is little risk of stale assets or offline-state bugs in this iteration.

## Verification

Validation focuses on presentation and install behavior, not offline behavior.

### Asset Checks

- Confirm the new app icon reads clearly at small square sizes.
- Confirm the new agent profile image looks better composed than the current crop.
- Confirm both assets clearly come from the same source artwork.

### Shell Checks

- Confirm the manifest resolves correctly.
- Confirm icon references resolve correctly.
- Confirm the installed/home-screen presentation uses the new square warrior icon.
- Confirm standalone-oriented metadata is present for mobile install flows.

### Browser Validation

Per project instructions, validate UI changes in the browser by:

- opening the relevant app page
- checking the updated in-app agent image
- inspecting manifest/icon behavior in browser tooling or mobile emulation
- confirming the add-to-home-screen experience is configured as intended

### Explicitly Skipped

- service-worker validation
- offline-mode validation
- background sync testing

These are intentionally out of scope for this design.
