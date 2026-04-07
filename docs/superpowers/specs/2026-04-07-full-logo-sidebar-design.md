# Full Logo in Sidebar, Login, and Mobile Header

## Summary

Replace the hardcoded purple "E" icon + "Eidon" text with the existing full logo image (`public/logo.png`) in three locations: sidebar, login page, and mobile header.

## Current State

Three files have duplicated hardcoded branding using a purple `<div>` containing the letter "E" and a `<span>` with "Eidon":

- `components/sidebar.tsx` lines 1020-1044 — sidebar top-left
- `components/login-form.tsx` lines 45-55 — top of login card
- `components/shell.tsx` line 65 — mobile header (text only, no icon)

`public/logo.png` (1022x743px, aspect ratio ~1.37:1) exists but is unused.

## Changes

### All three locations

Replace the hardcoded E + "Eidon" markup with `next/image` `<Image>` pointing to `/logo.png` with `alt="Eidon"`.

| Location | File | Image Size |
|---|---|---|
| Sidebar | `components/sidebar.tsx` | `height={36} width={50}` |
| Login card | `components/login-form.tsx` | `height={80} width={110}` |
| Mobile header | `components/shell.tsx` | `height={24} width={34}` |

Sidebar and login versions use `priority` (above the fold). The existing Link wrapper, hover effects, and surrounding layout stay unchanged.

## What Doesn't Change

- Layout structure, spacing, link behavior
- Mobile hamburger button, login form fields
- The logo file itself
- Any other UI components
