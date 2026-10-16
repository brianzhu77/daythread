# Craft daily-page visual regression review

Ratchet · task #26 · implementation eeb72e0 · 2026-10-16.

Conclusion: no blocking regression found in the executed local paths. Brian's approval of the visual direction is still required. Page tree/URL-page drafts are static proposals; no nested-page implementation is claimed.

Independent setup: test/first-slice worktree merged eeb72e0, isolated Vite 3012 and disposable JSON file, freshly reset and populated through Add sample data. Chromium via browse at 390×844 and 1280×900. A separate Playwright Chromium context set hasTouch=true/isMobile=true for coarse-pointer verification; it is not a real iPhone. Only seed/generated test text used.

Executed and passed:
- Native suite: 35/35, zero skips. No application code changed by reviewer.
- Day page: Keep one prior Task, Bring one prior material line, Done; identity and placement behavior still works.
- Long Chinese Task title: Enter saved without newline; textarea clientHeight=scrollHeight=176px, full content visible and persisted. No horizontal overflow (390px document and viewport).
- Capture fixed bar: inspected real viewport at top/middle/bottom. At bottom Review entry ended at 684.4px and Capture began at 750.3px, leaving 65.9px. Content can be scrolled above the fixed bar; the earlier full-page screenshot overlap was not a final-content occlusion.
- Dev controls collapse to a single line while local/simulated label remains visible; expanding exposes fixture/outcome controls.
- Touch emulation: pointer:coarse=true, hover:hover=false; Task ⋯ opacity=1 without hovering. Tapping opened the menu. CSS inspection retained focus-within for fine-pointer keyboard access; a dedicated keyboard-only navigation pass was not run.
- Plan deletion: empty title/Backspace → Keep planned → Put back completed; Task remained available.
- Capture: new Chinese input saved directly with simulated receipt. Simulated budget failure retained original input; switching outcome to success and Retry succeeded. Simulation controls were exercised after workspace hydration.
- Review: opened from reminder URL, advanced to Saved items, Finish persisted reviewSaved=true; Lower priority and navigation to reflection worked. Reflection saved without becoming a Task.
- Prepare tomorrow: Related and Top 3 rows displayed; removed one task and one material, injected an independent repository revision, save failed retaining choices, explicit Retry succeeded and reload/disk retained 2 task IDs and 1 material ID. No automatic overwrite.
- Simulated draft failure showed Review saved · suggestions couldn't be prepared · Retry; success retry restored suggestions without losing saved review.
- Browser page-error/console checks in these flows showed no errors.

Screenshots under evidence/craft-visual/ were opened and inspected: top, wrapped Chinese title, bottom spacing, desktop, touch-menu. Visual assessment: document hierarchy and spacing are clearer than the prior functional scaffold. The long Task shares width with a deadline tag, so it wraps narrowly; this is a design tradeoff, not data truncation.

Not executed: actual iPhone/Safari, software keyboard/IME composition, reminder delivery, cloud auth/RLS, actual model/context/billing. Existing functional limitations (Pages/Upcoming, arbitrary block editing and v0.4 nested pages) remain outside this visual change. Coarse-pointer emulation does not prove real-device usability.
