# PR141 independent retest

Candidate 80c90d97. Changes requested for the leave-page exception. No application changes by reviewer.

Build passes. The original held-save and failed-save/recovery fixtures pass independently in Chromium and WebKit on fresh throwaway SQLite stores: property creation follows the column save, failure leaves the source untouched, recovery creates the property with Undo.

## Leaving repeats the original ordering bug

1. Open the seeded linked view, type HOLD on the line above, and hold the first save-editor request.
2. Click the linked view’s +, then the sidebar Pages link before releasing that request.
3. Release it and wait for saves to finish.

Both Chromium and WebKit produce save-editor → addProperty → save-editor. The source property exists, and the workspace receipt history ends Page saved, Added Property, Page saved. The stored Undo operation belongs to the final page save, replacing the property operation. This establishes loss of property Undo independently of whether the new screen displays a toast.

The new saved() loop exits on left.current, allowing addProperty to race the leave save. It must instead wait for successful persistence or explicitly cancel the addition on leave. The submitted leave fixture asserts the property remains the final Undo target; it fails on the candidate.

Repeated clicks during failed saves queue multiple invisible additions, as the author disclosed. That is a separate usability concern; disabling the pending + or displaying its pending state would avoid surprise additions. No Worker, real Postgres, native device, complete author baseline, or large-database performance run by reviewer.
