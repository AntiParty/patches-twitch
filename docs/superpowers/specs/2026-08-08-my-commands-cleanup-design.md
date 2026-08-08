# My Commands cleanup

## Goal

Make command availability quick to scan and act on without competing with
custom-response editing.

## Design

Place a full-width **Command availability** card directly below the page
header. Each row contains the command name, its API-provided description, a
clear Enabled/Disabled status, and one Enable or Disable button. The rows use
consistent spacing and retain a usable mobile layout.

Below the strip, retain the existing two-column response editor and live
preview. Custom responses remain independent from availability: disabling a
command preserves its response.

## Verification

Build and lint the React application after the layout change. No API, command,
or database behavior changes are part of this cleanup.
